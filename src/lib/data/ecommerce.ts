import { queryOne, queryRows } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { hasRole } from "@/lib/auth/roles";
import { AuthorizationError, DataAccessError } from "@/lib/data/master-data";
import { logger } from "@/lib/logger";
import { todayInTimeZone } from "@/lib/imports/validate";
import {
  addMonths,
  cumulativeVsTarget,
  dailyGmvSeries,
  incompleteChannels,
  momEquivalent,
  monthlySummary,
  monthStart,
  targetScorecard,
  totals,
  type DailyFact,
  type Totals,
} from "@/lib/ecommerce/kpi";
import { daysBetween, resolveRange, type RangeInput, type ResolvedRange } from "@/lib/ecommerce/date-range";
import { getKpiSettings, type KpiSettings } from "@/lib/organization/settings";

/**
 * E-commerce read model: loads committed facts for the caller's organization
 * and hands them to the pure KPI functions in src/lib/ecommerce/kpi.ts.
 * Tenant isolation: every query is scoped to session.organization.id.
 *
 * The as-of date is the latest date with shop data on or before "today" in
 * the organization's timezone; the reporting month is that date's month. So
 * the dashboard shows the most recent complete picture instead of an empty
 * current month while reports are still being uploaded.
 */

export type ChannelInfo = { code: string; name: string };

export type SkuContribution = {
  /** null = listing not mapped to an internal SKU yet. */
  sku: string | null;
  name: string | null;
  gmv: number;
  /** Internal SKU units (listing units × units per listing). */
  units: number;
};

export type EcommerceOverview =
  | { status: "empty" }
  | {
      status: "ok";
      asOf: string;
      month: string;
      channels: ChannelInfo[];
      months: ReturnType<typeof monthlySummary>;
      targets: ReturnType<typeof targetScorecard>;
      incomplete: ReturnType<typeof incompleteChannels>;
      mom: ReturnType<typeof momEquivalent>;
      skus: SkuContribution[];
      /** Listing GMV vs shop GMV for the month (product reports may lag the shop report). */
      skuCoverage: { listingGmv: number; shopGmv: number };
      /** Series for the dashboard charts. */
      charts: {
        /** Daily GMV per channel from the start of the previous month to the as-of date. */
        daily: ReturnType<typeof dailyGmvSeries>;
        /** Cumulative GMV vs straight-line target pace for the as-of month; null without targets. */
        cumulative: ReturnType<typeof cumulativeVsTarget>;
      };
      lastImportAt: string | null;
      kpi: KpiSettings;
    };

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const n = (v: string | number | null) => (v === null ? 0 : Number(v));

async function guarded<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    logger.error("data.query_failed", { operation, error });
    throw new DataAccessError(operation);
  }
}

export async function getEcommerceOverview(
  session: ActiveSession,
  { today = todayInTimeZone(session.organization.timezone), months = 3 }: { today?: string; months?: number } = {},
): Promise<EcommerceOverview> {
  if (!hasRole(session.role, "viewer")) throw new AuthorizationError("viewer");
  const org = session.organization.id;

  return guarded("ecommerce_overview", async () => {
    const latest = await queryOne<{ d: Date | string | null }>(
      "SELECT MAX(fact_date) AS d FROM sales_daily_facts WHERE organization_id = ? AND fact_date <= ?",
      [org, today],
    );
    if (!latest?.d) return { status: "empty" };
    const asOf = iso(latest.d);
    const from = addMonths(asOf, -(months - 1));

    const [kpi, channelRows, factRows, targetRows, skuRows, coverage, lastImport] = await Promise.all([
      getKpiSettings(session),
      queryRows<ChannelInfo>("SELECT code, name FROM channels WHERE kind = 'marketplace' ORDER BY sort_order"),
      queryRows<{
        code: string;
        fact_date: Date | string;
        gmv: string | number;
        orders: number;
        units_sold: number;
        visitors: number;
      }>(
        `SELECT c.code, f.fact_date, f.gmv, f.orders, f.units_sold, f.visitors
           FROM sales_daily_facts f JOIN channels c ON c.id = f.channel_id
          WHERE f.organization_id = ? AND f.fact_date BETWEEN ? AND ?`,
        [org, from, asOf],
      ),
      queryRows<{ code: string; target_gmv: string | number }>(
        `SELECT c.code, t.target_gmv
           FROM sales_targets t JOIN channels c ON c.id = t.channel_id
          WHERE t.organization_id = ? AND t.target_month = ?`,
        [org, monthStart(asOf)],
      ),
      queryRows<{ sku: string | null; name: string | null; gmv: string | number; units: string | number }>(
        `SELECT v.sku, v.name, SUM(f.gmv) AS gmv, SUM(f.units_sold * l.units_per_listing) AS units
           FROM listing_daily_facts f
           JOIN channel_listings l ON l.organization_id = f.organization_id AND l.id = f.listing_id
           LEFT JOIN product_variants v ON v.organization_id = l.organization_id AND v.id = l.variant_id
          WHERE f.organization_id = ? AND f.fact_date BETWEEN ? AND ?
          GROUP BY v.sku, v.name
          ORDER BY gmv DESC`,
        [org, monthStart(asOf), asOf],
      ),
      queryOne<{ gmv: string | number | null }>(
        `SELECT SUM(gmv) AS gmv FROM sales_daily_facts
          WHERE organization_id = ? AND fact_date BETWEEN ? AND ?`,
        [org, monthStart(asOf), asOf],
      ),
      queryOne<{ at: Date | null }>(
        `SELECT MAX(committed_at) AS at FROM import_batches
          WHERE organization_id = ? AND status = 'committed'`,
        [org],
      ),
    ]);

    const channels = channelRows.map((c) => c.code);
    const facts: DailyFact[] = factRows.map((r) => ({
      channel: r.code,
      date: iso(r.fact_date),
      gmv: n(r.gmv),
      orders: r.orders,
      units: r.units_sold,
      visitors: r.visitors,
    }));
    const targets = targetRows.map((t) => ({ channel: t.code, targetGmv: n(t.target_gmv) }));
    const skus = skuRows.map((r) => ({ sku: r.sku, name: r.name, gmv: n(r.gmv), units: n(r.units) }));

    return {
      status: "ok",
      asOf,
      month: asOf.slice(0, 7),
      channels: channelRows,
      months: monthlySummary(facts, channels, asOf, months),
      mom: momEquivalent(facts, channels, asOf),
      targets: targetScorecard(facts, targets, channels, asOf, kpi.thresholds),
      incomplete: incompleteChannels(facts, channels, asOf),
      skus,
      skuCoverage: { listingGmv: skus.reduce((s, r) => s + r.gmv, 0), shopGmv: n(coverage?.gmv ?? null) },
      charts: {
        daily: dailyGmvSeries(facts, channels, addMonths(asOf, -1), asOf),
        cumulative: cumulativeVsTarget(facts, targets, asOf),
      },
      lastImportAt: lastImport?.at ? lastImport.at.toISOString() : null,
      kpi,
    };
  });
}

export type RangeChannelRow = {
  code: string;
  name: string;
  current: Totals;
  previous: Totals;
  gmvChange: number | null;
  ordersChange: number | null;
  aovChange: number | null;
};

export type SalesForRange =
  | { status: "empty" }
  | {
      /**
       * No shop report yet, but product and/or marketplace-ads reports exist:
       * the range is anchored on those so their sections can still be shown.
       * Shop KPIs (GMV, orders, AOV, conversion) are unknown — never zero.
       */
      status: "partial";
      asOf: string;
      dataFrom: string;
      range: ResolvedRange;
      skus: SkuContribution[];
      skuCoverage: { listingGmv: number; shopGmv: null };
      lastImportAt: string | null;
      kpi: KpiSettings;
    }
  | {
      status: "ok";
      asOf: string;
      /** Earliest shop data date (lower bound for the date picker). */
      dataFrom: string;
      range: ResolvedRange;
      current: Totals;
      previous: Totals;
      gmvChange: number | null;
      ordersChange: number | null;
      aovChange: number | null;
      conversionChange: number | null;
      channels: RangeChannelRow[];
      /** Channels with fewer days of data than the range length (within data up to asOf). */
      incomplete: { code: string; name: string; missingDays: number }[];
      lastImportAt: string | null;
      /** Only with { includeSkus: true }. */
      skus?: SkuContribution[];
      /** Listing GMV vs shop GMV in the range (product reports may lag the shop report). */
      skuCoverage?: { listingGmv: number; shopGmv: number };
      kpi: KpiSettings;
    };

const pctChange = (cur: number | null, prev: number | null) =>
  cur === null || prev === null || prev === 0 ? null : cur / prev - 1;

/**
 * Shop KPIs for a dashboard date range (presets anchored on the as-of date)
 * plus the comparison period. Tenant-scoped like every read model.
 */
export async function getSalesForRange(
  session: ActiveSession,
  input: RangeInput,
  {
    today = todayInTimeZone(session.organization.timezone),
    includeSkus = false,
  }: { today?: string; includeSkus?: boolean } = {},
): Promise<SalesForRange> {
  if (!hasRole(session.role, "viewer")) throw new AuthorizationError("viewer");
  const org = session.organization.id;

  return guarded("sales_for_range", async () => {
    const [bounds, kpi] = await Promise.all([
      queryOne<{ first: Date | string | null; last: Date | string | null }>(
        `SELECT MIN(fact_date) AS first, MAX(fact_date) AS last
           FROM sales_daily_facts WHERE organization_id = ? AND fact_date <= ?`,
        [org, today],
      ),
      getKpiSettings(session),
    ]);
    if (!bounds?.last || !bounds.first) return partialRange(org, input, today, kpi);
    const asOf = iso(bounds.last);
    const range = resolveRange(input, asOf, kpi.defaultRange);

    const [channelRows, factRows, lastImport, skuRows] = await Promise.all([
      queryRows<ChannelInfo>("SELECT code, name FROM channels WHERE kind = 'marketplace' ORDER BY sort_order"),
      queryRows<{
        code: string;
        fact_date: Date | string;
        gmv: string | number;
        orders: number;
        units_sold: number;
        visitors: number;
      }>(
        `SELECT c.code, f.fact_date, f.gmv, f.orders, f.units_sold, f.visitors
           FROM sales_daily_facts f JOIN channels c ON c.id = f.channel_id
          WHERE f.organization_id = ?
            AND (f.fact_date BETWEEN ? AND ? OR f.fact_date BETWEEN ? AND ?)`,
        [org, range.from, range.to, range.compare.from, range.compare.to],
      ),
      queryOne<{ at: Date | null }>(
        `SELECT MAX(committed_at) AS at FROM import_batches
          WHERE organization_id = ? AND status = 'committed'`,
        [org],
      ),
      includeSkus ? skuRowsFor(org, range) : Promise.resolve(null),
    ]);

    const facts: DailyFact[] = factRows.map((r) => ({
      channel: r.code,
      date: iso(r.fact_date),
      gmv: n(r.gmv),
      orders: r.orders,
      units: r.units_sold,
      visitors: r.visitors,
    }));
    const inCur = facts.filter((f) => f.date >= range.from && f.date <= range.to);
    const inPrev = facts.filter((f) => f.date >= range.compare.from && f.date <= range.compare.to);
    const current = totals(inCur);
    const previous = totals(inPrev);

    // Days that SHOULD have data: the range clipped to the as-of date.
    const lastExpected = range.to < asOf ? range.to : asOf;
    const expectedDays = lastExpected < range.from ? 0 : daysBetween(range.from, lastExpected);

    const channels = channelRows.map((c) => {
      const cur = totals(inCur.filter((f) => f.channel === c.code));
      const prev = totals(inPrev.filter((f) => f.channel === c.code));
      return {
        code: c.code,
        name: c.name,
        current: cur,
        previous: prev,
        gmvChange: pctChange(cur.gmv, prev.gmv),
        ordersChange: pctChange(cur.orders, prev.orders),
        aovChange: pctChange(cur.aov, prev.aov),
      };
    });

    return {
      status: "ok",
      asOf,
      dataFrom: iso(bounds.first),
      range,
      current,
      previous,
      gmvChange: pctChange(current.gmv, previous.gmv),
      ordersChange: pctChange(current.orders, previous.orders),
      aovChange: pctChange(current.aov, previous.aov),
      conversionChange: pctChange(current.conversionRate, previous.conversionRate),
      channels,
      incomplete: channels
        .map((c) => ({ code: c.code, name: c.name, missingDays: expectedDays - c.current.days }))
        .filter((c) => c.missingDays > 0),
      lastImportAt: lastImport?.at ? lastImport.at.toISOString() : null,
      kpi,
      ...(skuRows ? skuSection(skuRows, current.gmv) : {}),
    };
  });
}

type SkuRow = { sku: string | null; name: string | null; gmv: string | number; units: string | number };

function skuRowsFor(org: string, range: { from: string; to: string }) {
  return queryRows<SkuRow>(
    `SELECT v.sku, v.name, SUM(f.gmv) AS gmv, SUM(f.units_sold * l.units_per_listing) AS units
       FROM listing_daily_facts f
       JOIN channel_listings l ON l.organization_id = f.organization_id AND l.id = f.listing_id
       LEFT JOIN product_variants v ON v.organization_id = l.organization_id AND v.id = l.variant_id
      WHERE f.organization_id = ? AND f.fact_date BETWEEN ? AND ?
      GROUP BY v.sku, v.name
      ORDER BY gmv DESC`,
    [org, range.from, range.to],
  );
}

/** Range anchored on product / marketplace-ads reports when no shop report exists yet. */
async function partialRange(org: string, input: RangeInput, today: string, kpi: KpiSettings): Promise<SalesForRange> {
  const b = await queryOne<{ first: Date | string | null; last: Date | string | null }>(
    `SELECT MIN(d) AS first, MAX(d) AS last FROM (
       SELECT fact_date AS d FROM listing_daily_facts WHERE organization_id = ? AND fact_date <= ?
       UNION ALL
       SELECT fact_date AS d FROM marketplace_ad_daily_facts WHERE organization_id = ? AND fact_date <= ?
     ) x`,
    [org, today, org, today],
  );
  if (!b?.last || !b.first) return { status: "empty" };
  const asOf = iso(b.last);
  const range = resolveRange(input, asOf, kpi.defaultRange);
  const [rows, lastImport] = await Promise.all([
    skuRowsFor(org, range),
    queryOne<{ at: Date | null }>(
      `SELECT MAX(committed_at) AS at FROM import_batches WHERE organization_id = ? AND status = 'committed'`,
      [org],
    ),
  ]);
  const skus = rows.map((r) => ({ sku: r.sku, name: r.name, gmv: n(r.gmv), units: n(r.units) }));
  return {
    status: "partial",
    asOf,
    dataFrom: iso(b.first),
    range,
    skus,
    skuCoverage: { listingGmv: skus.reduce((s, r) => s + r.gmv, 0), shopGmv: null },
    lastImportAt: lastImport?.at ? lastImport.at.toISOString() : null,
    kpi,
  };
}

function skuSection(rows: SkuRow[], shopGmv: number) {
  const skus = rows.map((r) => ({ sku: r.sku, name: r.name, gmv: n(r.gmv), units: n(r.units) }));
  return { skus, skuCoverage: { listingGmv: skus.reduce((s, r) => s + r.gmv, 0), shopGmv } };
}
