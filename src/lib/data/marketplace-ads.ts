import { queryRows } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { hasRole } from "@/lib/auth/roles";
import { AuthorizationError, DataAccessError } from "@/lib/data/master-data";
import { logger } from "@/lib/logger";

/**
 * Marketplace ads (e.g. Shopee Ads) per channel for a date range, from
 * marketplace_ad_daily_facts. Tenant-scoped. "gmv" is the sales the
 * marketplace attributes to its ads — not additive with shop GMV.
 */
export type MarketplaceAdsRow = {
  code: string;
  name: string;
  /** Distinct days with an ads report in the range. */
  days: number;
  campaigns: number;
  cost: number;
  gmv: number;
  impressions: number;
  clicks: number;
  conversions: number;
  units: number;
};

const n = (v: string | number | null) => (v === null ? 0 : Number(v));

export async function getMarketplaceAds(
  session: ActiveSession,
  { from, to }: { from: string; to: string },
): Promise<MarketplaceAdsRow[]> {
  if (!hasRole(session.role, "viewer")) throw new AuthorizationError("viewer");
  try {
    const rows = await queryRows<{
      code: string;
      name: string;
      days: number;
      campaigns: number;
      cost: string | number;
      gmv: string | number;
      impressions: string | number;
      clicks: string | number;
      conversions: string | number;
      units: string | number;
    }>(
      `SELECT c.code, c.name, COUNT(DISTINCT f.fact_date) AS days, COUNT(DISTINCT f.campaign_key) AS campaigns,
              SUM(f.cost) AS cost, SUM(f.gmv) AS gmv, SUM(f.impressions) AS impressions, SUM(f.clicks) AS clicks,
              SUM(f.conversions) AS conversions, SUM(f.units_sold) AS units
         FROM marketplace_ad_daily_facts f JOIN channels c ON c.id = f.channel_id
        WHERE f.organization_id = ? AND f.fact_date BETWEEN ? AND ?
        GROUP BY c.code, c.name, c.sort_order
        ORDER BY c.sort_order`,
      [session.organization.id, from, to],
    );
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      days: Number(r.days),
      campaigns: Number(r.campaigns),
      cost: n(r.cost),
      gmv: n(r.gmv),
      impressions: n(r.impressions),
      clicks: n(r.clicks),
      conversions: n(r.conversions),
      units: n(r.units),
    }));
  } catch (error) {
    logger.error("data.query_failed", { operation: "marketplace_ads", error });
    throw new DataAccessError("marketplace_ads");
  }
}
