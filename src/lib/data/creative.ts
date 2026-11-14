import { queryOne, queryRows } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { hasRole } from "@/lib/auth/roles";
import { AuthorizationError, DataAccessError } from "@/lib/data/master-data";
import { logger } from "@/lib/logger";
import { todayInTimeZone } from "@/lib/imports/validate";
import { addDays, resolveRange, type RangeInput, type ResolvedRange } from "@/lib/ecommerce/date-range";
import { getKpiSettings } from "@/lib/organization/settings";
import {
  adMetrics,
  fatigue,
  groupBy,
  isWinner,
  type AdDailyFact,
  type AdMetrics,
  type Classified,
  type CreativeFormat,
  type Fatigue,
} from "@/lib/creative/creative";

/**
 * Creative read model (Phase 4). Tenant isolation: every query is scoped to
 * session.organization.id.
 */

/** History loaded for fatigue detection (an ad's first vs last 7 active days). */
export const FATIGUE_LOOKBACK_DAYS = 180;

export type AdInfo = {
  adId: string;
  name: string;
  campaign: string | null;
  adset: string | null;
  assetId: string | null;
  assetName: string | null;
  product: string | null;
  hook: string | null;
  angle: string | null;
  format: CreativeFormat | null;
  batch: string | null;
  version: string | null;
  source: "parsed" | "manual";
  parseStatus: "ok" | "partial" | "failed";
};

export type AdRow = AdInfo & {
  metrics: AdMetrics;
  winner: boolean;
  fatigue: Fatigue;
  firstDate: string;
  lastDate: string;
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

type FactRow = {
  ad_id: string;
  d: Date | string;
  spend: string | number;
  impressions: number;
  reach: number | null;
  link_clicks: number;
  purchases: number;
  purchase_value: string | number;
};

const mapFact = (r: FactRow): AdDailyFact => ({
  adId: r.ad_id,
  date: iso(r.d),
  spend: n(r.spend),
  impressions: r.impressions,
  reach: r.reach,
  clicks: r.link_clicks,
  purchases: r.purchases,
  revenue: n(r.purchase_value),
});

type AdInfoRow = {
  ad_id: string;
  ad_name: string;
  campaign_name: string | null;
  adset_name: string | null;
  asset_id: string | null;
  asset_name: string | null;
  product: string | null;
  hook: string | null;
  angle: string | null;
  format: CreativeFormat | null;
  batch: string | null;
  version: string | null;
  source: "parsed" | "manual" | null;
  parse_status: "ok" | "partial" | "failed" | null;
};

const AD_INFO_SELECT = `SELECT a.ad_id, a.ad_name, a.campaign_name, a.adset_name, a.asset_id, s.name AS asset_name,
         c.product, c.hook, c.angle, c.format, c.batch, c.version, c.source, c.parse_status
    FROM meta_ads a
    LEFT JOIN creative_classifications c ON c.organization_id = a.organization_id AND c.ad_id = a.ad_id
    LEFT JOIN creative_assets s ON s.organization_id = a.organization_id AND s.id = a.asset_id`;

const mapInfo = (r: AdInfoRow): AdInfo => ({
  adId: r.ad_id,
  name: r.ad_name,
  campaign: r.campaign_name,
  adset: r.adset_name,
  assetId: r.asset_id,
  assetName: r.asset_name,
  product: r.product,
  hook: r.hook,
  angle: r.angle,
  format: r.format,
  batch: r.batch,
  version: r.version,
  source: r.source ?? "parsed",
  parseStatus: r.parse_status ?? "failed",
});

export type CreativeOverview =
  | { status: "empty" }
  | {
      status: "ok";
      asOf: string;
      dataFrom: string;
      range: ResolvedRange;
      current: AdMetrics;
      previous: AdMetrics;
      ads: AdRow[];
      formats: ReturnType<typeof groupBy>;
      hooks: ReturnType<typeof groupBy>;
      angles: ReturnType<typeof groupBy>;
      /** Motion Image vs Video in Frame for the range. */
      miVsVif: { mi: AdMetrics | null; vif: AdMetrics | null };
      lastImportAt: string | null;
    };

export async function getCreativeOverview(
  session: ActiveSession,
  input: RangeInput,
  { today = todayInTimeZone(session.organization.timezone) }: { today?: string } = {},
): Promise<CreativeOverview> {
  if (!hasRole(session.role, "viewer")) throw new AuthorizationError("viewer");
  const org = session.organization.id;
  return guarded("creative_overview", async () => {
    const [bounds, kpi] = await Promise.all([
      queryOne<{ first: Date | string | null; last: Date | string | null }>(
        `SELECT MIN(fact_date) AS first, MAX(fact_date) AS last
           FROM meta_ad_daily_facts WHERE organization_id = ? AND fact_date <= ?`,
        [org, today],
      ),
      getKpiSettings(session),
    ]);
    if (!bounds?.last || !bounds.first) return { status: "empty" };
    const asOf = iso(bounds.last);
    const range = resolveRange(input, asOf, kpi.defaultRange);
    const from = [range.compare.from, addDays(asOf, -FATIGUE_LOOKBACK_DAYS)].sort()[0];

    const [factRows, infoRows, lastImport] = await Promise.all([
      queryRows<FactRow>(
        `SELECT ad_id, fact_date AS d, spend, impressions, reach, link_clicks, purchases, purchase_value
           FROM meta_ad_daily_facts WHERE organization_id = ? AND fact_date BETWEEN ? AND ?`,
        [org, from, asOf],
      ),
      queryRows<AdInfoRow>(`${AD_INFO_SELECT} WHERE a.organization_id = ?`, [org]),
      queryOne<{ at: Date | null }>(
        `SELECT MAX(committed_at) AS at FROM import_batches
          WHERE organization_id = ? AND status = 'committed' AND report_type = 'meta_ads_performance'`,
        [org],
      ),
    ]);

    const facts = factRows.map(mapFact);
    const inRange = (f: AdDailyFact) => f.date >= range.from && f.date <= range.to;
    const cur = facts.filter(inRange);
    const prev = facts.filter((f) => f.date >= range.compare.from && f.date <= range.compare.to);
    const current = adMetrics(cur);
    const previous = adMetrics(prev);
    const infos = new Map(infoRows.map((r) => [r.ad_id, mapInfo(r)]));

    const byAd = new Map<string, AdDailyFact[]>();
    const historyByAd = new Map<string, AdDailyFact[]>();
    for (const f of facts) {
      if (f.date <= range.to) (historyByAd.get(f.adId) ?? historyByAd.set(f.adId, []).get(f.adId)!).push(f);
      if (inRange(f)) (byAd.get(f.adId) ?? byAd.set(f.adId, []).get(f.adId)!).push(f);
    }
    const ads: AdRow[] = [...byAd.entries()]
      .filter(([, list]) => list.some((f) => f.spend > 0 || f.impressions > 0))
      .map(([adId, list]) => {
        const metrics = adMetrics(list);
        const dates = list.map((f) => f.date).sort();
        return {
          ...(infos.get(adId) ?? mapInfo({ ad_id: adId, ad_name: adId } as AdInfoRow)),
          metrics,
          winner: isWinner(metrics, current.roas),
          fatigue: fatigue(historyByAd.get(adId) ?? list),
          firstDate: dates[0],
          lastDate: dates[dates.length - 1],
        };
      })
      .sort((a, b) => b.metrics.spend - a.metrics.spend);

    const classes = new Map<string, Classified>(
      ads.map((a) => [a.adId, { adId: a.adId, format: a.format, hook: a.hook, angle: a.angle }]),
    );
    const formats = groupBy(cur, classes, "format");
    const fmt = (k: CreativeFormat) => formats.find((g) => g.key === k)?.metrics ?? null;

    return {
      status: "ok",
      asOf,
      dataFrom: iso(bounds.first),
      range,
      current,
      previous,
      ads,
      formats,
      hooks: groupBy(cur, classes, "hook"),
      angles: groupBy(cur, classes, "angle"),
      miVsVif: { mi: fmt("motion_image"), vif: fmt("video_in_frame") },
      lastImportAt: lastImport?.at ? lastImport.at.toISOString() : null,
    };
  });
}

export type AdDetail =
  | { status: "not_found" }
  | {
      status: "ok";
      info: AdInfo;
      asOf: string;
      daily: AdDailyFact[];
      lifetime: AdMetrics;
      last7: AdMetrics;
      fatigue: Fatigue;
      assets: { id: string; name: string }[];
    };

export async function getAdDetail(session: ActiveSession, adId: string): Promise<AdDetail> {
  if (!hasRole(session.role, "viewer")) throw new AuthorizationError("viewer");
  const org = session.organization.id;
  return guarded("creative_ad", async () => {
    const info = await queryOne<AdInfoRow>(`${AD_INFO_SELECT} WHERE a.organization_id = ? AND a.ad_id = ?`, [
      org,
      adId,
    ]);
    if (!info) return { status: "not_found" };
    const [rows, assets] = await Promise.all([
      queryRows<FactRow>(
        `SELECT ad_id, fact_date AS d, spend, impressions, reach, link_clicks, purchases, purchase_value
           FROM meta_ad_daily_facts WHERE organization_id = ? AND ad_id = ? ORDER BY fact_date`,
        [org, adId],
      ),
      queryRows<{ id: string; name: string }>(
        "SELECT id, name FROM creative_assets WHERE organization_id = ? ORDER BY name",
        [org],
      ),
    ]);
    const daily = rows.map(mapFact);
    return {
      status: "ok",
      info: mapInfo(info),
      asOf: daily.length ? daily[daily.length - 1].date : "",
      daily,
      lifetime: adMetrics(daily),
      last7: adMetrics(daily.slice(-7)),
      fatigue: fatigue(daily),
      assets,
    };
  });
}

export type CreativeAsset = {
  id: string;
  name: string;
  format: CreativeFormat;
  url: string | null;
  thumbnailUrl: string | null;
  sku: string | null;
  notes: string | null;
  ads: number;
  spend: number;
  revenue: number;
  createdAt: string;
};

export async function listCreativeAssets(session: ActiveSession): Promise<CreativeAsset[]> {
  if (!hasRole(session.role, "viewer")) throw new AuthorizationError("viewer");
  const org = session.organization.id;
  return guarded("creative_assets", async () => {
    const rows = await queryRows<{
      id: string;
      name: string;
      format: CreativeFormat;
      url: string | null;
      thumbnail_url: string | null;
      sku: string | null;
      notes: string | null;
      ads: string | number;
      spend: string | number | null;
      revenue: string | number | null;
      created_at: Date;
    }>(
      `SELECT s.id, s.name, s.format, s.url, s.thumbnail_url, v.sku, s.notes, s.created_at,
              (SELECT COUNT(*) FROM meta_ads a WHERE a.organization_id = s.organization_id AND a.asset_id = s.id) AS ads,
              (SELECT SUM(f.spend) FROM meta_ad_daily_facts f JOIN meta_ads a
                  ON a.organization_id = f.organization_id AND a.ad_id = f.ad_id
                WHERE a.organization_id = s.organization_id AND a.asset_id = s.id) AS spend,
              (SELECT SUM(f.purchase_value) FROM meta_ad_daily_facts f JOIN meta_ads a
                  ON a.organization_id = f.organization_id AND a.ad_id = f.ad_id
                WHERE a.organization_id = s.organization_id AND a.asset_id = s.id) AS revenue
         FROM creative_assets s
         LEFT JOIN product_variants v ON v.organization_id = s.organization_id AND v.id = s.variant_id
        WHERE s.organization_id = ?
        ORDER BY s.created_at DESC`,
      [org],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      format: r.format,
      url: r.url,
      thumbnailUrl: r.thumbnail_url,
      sku: r.sku,
      notes: r.notes,
      ads: n(r.ads),
      spend: n(r.spend),
      revenue: n(r.revenue),
      createdAt: r.created_at.toISOString(),
    }));
  });
}
