import { queryOne, queryRows } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { hasRole } from "@/lib/auth/roles";
import { AuthorizationError, DataAccessError } from "@/lib/data/master-data";
import { logger } from "@/lib/logger";
import { todayInTimeZone } from "@/lib/imports/validate";
import { addMonths, monthStart } from "@/lib/ecommerce/kpi";
import { getKpiSettings, type PortfolioThresholds } from "@/lib/organization/settings";
import type { Touchpoint } from "@/lib/imports/templates";
import {
  monthPeriods,
  monthlyTrend,
  monthsUpTo,
  quadrantHistory,
  recommend,
  touchpointBreakdown,
  type Matrix,
  type Quadrant,
  type Recommendation,
  type SkuDailyFact,
  type TouchpointFact,
  type TouchpointTotals,
} from "@/lib/portfolio/portfolio";

/**
 * Portfolio read model (Phase 3). Loads listing and touchpoint facts mapped to
 * internal SKUs for the caller's organization and hands them to the pure
 * functions in src/lib/portfolio/portfolio.ts. Tenant isolation: every query
 * is scoped to session.organization.id.
 */

export const HISTORY_MONTHS = 12;

export type SkuInfo = {
  sku: string;
  name: string;
  productName: string;
  productType: "single" | "bundle";
};

type Loaded = {
  asOf: string;
  months: string[];
  skuFacts: SkuDailyFact[];
  touchpointFacts: TouchpointFact[];
  skus: Map<string, SkuInfo>;
  unmapped: { gmv: number; listings: number };
  thresholds: PortfolioThresholds;
  lastImportAt: string | null;
};

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const n = (v: string | number | null) => (v === null ? 0 : Number(v));
const nn = (v: string | number | null) => (v === null ? null : Number(v));

async function guarded<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    logger.error("data.query_failed", { operation, error });
    throw new DataAccessError(operation);
  }
}

/** Mapped facts from the first day of (as-of month − 12) to the as-of date. */
async function load(session: ActiveSession, today: string): Promise<Loaded | null> {
  const org = session.organization.id;
  const latest = await queryOne<{ d: Date | string | null }>(
    "SELECT MAX(fact_date) AS d FROM listing_daily_facts WHERE organization_id = ? AND fact_date <= ?",
    [org, today],
  );
  if (!latest?.d) return null;
  const asOf = iso(latest.d);
  const months = monthsUpTo(asOf, HISTORY_MONTHS);
  // One extra month so the oldest month has a comparison period.
  const from = addMonths(monthStart(asOf), -HISTORY_MONTHS);

  const [kpi, factRows, tpRows, skuRows, unmapped, lastImport] = await Promise.all([
    getKpiSettings(session),
    queryRows<{
      sku: string;
      d: Date | string;
      gmv: string | number;
      orders: string | number;
      units: string | number;
      visitors: string | number | null;
      clicks: string | number | null;
    }>(
      `SELECT v.sku, f.fact_date AS d, SUM(f.gmv) AS gmv, SUM(f.orders) AS orders,
              SUM(f.units_sold * l.units_per_listing) AS units,
              SUM(f.product_visitors) AS visitors, SUM(f.product_clicks) AS clicks
         FROM listing_daily_facts f
         JOIN channel_listings l ON l.organization_id = f.organization_id AND l.id = f.listing_id
         JOIN product_variants v ON v.organization_id = l.organization_id AND v.id = l.variant_id
        WHERE f.organization_id = ? AND f.fact_date BETWEEN ? AND ?
        GROUP BY v.sku, f.fact_date`,
      [org, from, asOf],
    ),
    queryRows<{
      sku: string;
      touchpoint: Touchpoint;
      d: Date | string;
      gmv: string | number;
      orders: string | number;
      cost: string | number | null;
    }>(
      `SELECT v.sku, t.touchpoint, t.fact_date AS d, SUM(t.gmv) AS gmv, SUM(t.orders) AS orders, SUM(t.cost) AS cost
         FROM touchpoint_daily_facts t
         JOIN channel_listings l ON l.organization_id = t.organization_id AND l.id = t.listing_id
         JOIN product_variants v ON v.organization_id = l.organization_id AND v.id = l.variant_id
        WHERE t.organization_id = ? AND t.fact_date BETWEEN ? AND ?
        GROUP BY v.sku, t.touchpoint, t.fact_date`,
      [org, from, asOf],
    ),
    queryRows<{ sku: string; name: string; product_name: string; product_type: "single" | "bundle" }>(
      `SELECT v.sku, v.name, p.name AS product_name, p.product_type
         FROM product_variants v JOIN products p ON p.organization_id = v.organization_id AND p.id = v.product_id
        WHERE v.organization_id = ?`,
      [org],
    ),
    queryOne<{ gmv: string | number | null; listings: string | number }>(
      `SELECT SUM(f.gmv) AS gmv, COUNT(DISTINCT f.listing_id) AS listings
         FROM listing_daily_facts f
         JOIN channel_listings l ON l.organization_id = f.organization_id AND l.id = f.listing_id
        WHERE f.organization_id = ? AND l.variant_id IS NULL AND f.fact_date BETWEEN ? AND ?`,
      [org, monthStart(asOf), asOf],
    ),
    queryOne<{ at: Date | null }>(
      "SELECT MAX(committed_at) AS at FROM import_batches WHERE organization_id = ? AND status = 'committed'",
      [org],
    ),
  ]);

  return {
    asOf,
    months,
    skuFacts: factRows.map((r) => ({
      sku: r.sku,
      date: iso(r.d),
      gmv: n(r.gmv),
      orders: n(r.orders),
      units: n(r.units),
      visitors: nn(r.visitors),
      clicks: nn(r.clicks),
    })),
    touchpointFacts: tpRows.map((r) => ({
      sku: r.sku,
      touchpoint: r.touchpoint,
      date: iso(r.d),
      gmv: n(r.gmv),
      orders: n(r.orders),
      cost: nn(r.cost),
    })),
    skus: new Map(
      skuRows.map((r) => [
        r.sku,
        { sku: r.sku, name: r.name, productName: r.product_name, productType: r.product_type },
      ]),
    ),
    unmapped: { gmv: n(unmapped?.gmv ?? null), listings: n(unmapped?.listings ?? 0) },
    thresholds: kpi.portfolio,
    lastImportAt: lastImport?.at ? lastImport.at.toISOString() : null,
  };
}

function pickMonth(months: string[], requested: string | undefined): string {
  return requested && months.includes(requested) ? requested : months[months.length - 1];
}

export type PortfolioOverview =
  | { status: "empty" }
  | {
      status: "ok";
      asOf: string;
      month: string;
      /** Months with data available for the month picker (oldest first). */
      months: string[];
      matrix: Matrix;
      history: { months: string[]; rows: { sku: string; quadrants: (Quadrant | null)[] }[] };
      skus: Record<string, SkuInfo>;
      recommendations: Record<string, Recommendation[]>;
      unmapped: { gmv: number; listings: number };
      thresholds: PortfolioThresholds;
      lastImportAt: string | null;
    };

export async function getPortfolioOverview(
  session: ActiveSession,
  { month, today = todayInTimeZone(session.organization.timezone) }: { month?: string; today?: string } = {},
): Promise<PortfolioOverview> {
  if (!hasRole(session.role, "viewer")) throw new AuthorizationError("viewer");
  return guarded("portfolio_overview", async () => {
    const data = await load(session, today);
    if (!data) return { status: "empty" };
    const history = quadrantHistory(data.skuFacts, data.months, data.asOf, data.thresholds);
    const withData = data.months.filter((_, i) => history.matrices[i].rows.length > 0);
    const selected = pickMonth(withData, month);
    const idx = data.months.indexOf(selected);
    const matrix = history.matrices[idx];

    const recommendations: Record<string, Recommendation[]> = {};
    for (const row of matrix.rows) {
      const tps = touchpointBreakdown(
        data.touchpointFacts.filter((t) => t.sku === row.sku),
        matrix.period,
        matrix.compare,
      );
      recommendations[row.sku] = recommend(row, tps, idx > 0 ? (history.bySku.get(row.sku)?.[idx - 1] ?? null) : null);
    }

    return {
      status: "ok",
      asOf: data.asOf,
      month: selected,
      months: withData,
      matrix,
      history: {
        months: data.months,
        rows: [...history.bySku.entries()]
          .map(([sku, quadrants]) => ({ sku, quadrants }))
          .sort(
            (a, b) =>
              (matrix.rows.findIndex((r) => r.sku === a.sku) + 1 || 99) -
              (matrix.rows.findIndex((r) => r.sku === b.sku) + 1 || 99),
          ),
      },
      skus: Object.fromEntries(data.skus),
      recommendations,
      unmapped: data.unmapped,
      thresholds: data.thresholds,
      lastImportAt: data.lastImportAt,
    };
  });
}

export type ProductDetail =
  | { status: "not_found" }
  | { status: "empty"; info: SkuInfo }
  | {
      status: "ok";
      info: SkuInfo;
      asOf: string;
      month: string;
      months: string[];
      trend: ReturnType<typeof monthlyTrend>;
      quadrants: (Quadrant | null)[];
      row: Matrix["rows"][number] | null;
      period: Matrix["period"];
      compare: Matrix["compare"];
      touchpoints: TouchpointTotals[];
      touchpointTrend: { month: string; byTouchpoint: Partial<Record<Touchpoint, number>> }[];
      recommendations: Recommendation[];
      listings: {
        channel: string;
        externalProductId: string;
        externalSkuId: string;
        name: string;
        unitsPerListing: number;
      }[];
      thresholds: PortfolioThresholds;
    };

export async function getProductDetail(
  session: ActiveSession,
  sku: string,
  { month, today = todayInTimeZone(session.organization.timezone) }: { month?: string; today?: string } = {},
): Promise<ProductDetail> {
  if (!hasRole(session.role, "viewer")) throw new AuthorizationError("viewer");
  return guarded("portfolio_product", async () => {
    const org = session.organization.id;
    const infoRow = await queryOne<{
      sku: string;
      name: string;
      product_name: string;
      product_type: "single" | "bundle";
    }>(
      `SELECT v.sku, v.name, p.name AS product_name, p.product_type
         FROM product_variants v JOIN products p ON p.organization_id = v.organization_id AND p.id = v.product_id
        WHERE v.organization_id = ? AND v.sku = ?`,
      [org, sku],
    );
    if (!infoRow) return { status: "not_found" };
    const info: SkuInfo = {
      sku: infoRow.sku,
      name: infoRow.name,
      productName: infoRow.product_name,
      productType: infoRow.product_type,
    };

    // The matrix needs every SKU (shares are relative), so load all and filter after.
    const data = await load(session, today);
    if (!data || !data.skuFacts.some((f) => f.sku === info.sku)) return { status: "empty", info };
    const history = quadrantHistory(data.skuFacts, data.months, data.asOf, data.thresholds);
    const withData = data.months.filter((_, i) => history.matrices[i].rows.some((r) => r.sku === info.sku));
    const selected = pickMonth(withData, month);
    const idx = data.months.indexOf(selected);
    const matrix = history.matrices[idx];
    const row = matrix.rows.find((r) => r.sku === info.sku) ?? null;
    const own = data.touchpointFacts.filter((t) => t.sku === info.sku);
    const touchpoints = touchpointBreakdown(own, matrix.period, matrix.compare);
    const quadrants = history.bySku.get(info.sku) ?? data.months.map(() => null);

    const listings = await queryRows<{
      channel: string;
      external_product_id: string;
      external_sku_id: string;
      listing_name: string;
      units_per_listing: number;
    }>(
      `SELECT c.name AS channel, l.external_product_id, l.external_sku_id, l.listing_name, l.units_per_listing
         FROM channel_listings l
         JOIN channels c ON c.id = l.channel_id
         JOIN product_variants v ON v.organization_id = l.organization_id AND v.id = l.variant_id
        WHERE l.organization_id = ? AND v.sku = ?
        ORDER BY c.sort_order, l.listing_name`,
      [org, info.sku],
    );

    return {
      status: "ok",
      info,
      asOf: data.asOf,
      month: selected,
      months: withData,
      trend: monthlyTrend(
        data.skuFacts.filter((f) => f.sku === info.sku),
        data.months,
        data.asOf,
      ),
      quadrants,
      row,
      period: matrix.period,
      compare: matrix.compare,
      touchpoints,
      touchpointTrend: data.months.map((m) => {
        const { period } = monthPeriods(m, data.asOf);
        const byTouchpoint: Partial<Record<Touchpoint, number>> = {};
        for (const t of own) {
          if (t.date >= period.from && t.date <= period.to) {
            byTouchpoint[t.touchpoint] = (byTouchpoint[t.touchpoint] ?? 0) + t.gmv;
          }
        }
        return { month: m, byTouchpoint };
      }),
      recommendations: row ? recommend(row, touchpoints, idx > 0 ? (quadrants[idx - 1] ?? null) : null) : [],
      listings: listings.map((l) => ({
        channel: l.channel,
        externalProductId: l.external_product_id,
        externalSkuId: l.external_sku_id,
        name: l.listing_name,
        unitsPerListing: l.units_per_listing,
      })),
      thresholds: data.thresholds,
    };
  });
}
