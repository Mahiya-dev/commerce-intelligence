import { queryOne, queryRows } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { hasRole } from "@/lib/auth/roles";
import { AuthorizationError, DataAccessError } from "@/lib/data/master-data";
import { logger } from "@/lib/logger";
import { todayInTimeZone } from "@/lib/imports/validate";
import { addDays, resolveRange, type RangeInput, type ResolvedRange } from "@/lib/ecommerce/date-range";
import { getKpiSettings, type AllocationSettings } from "@/lib/organization/settings";
import {
  consigned,
  idleStock,
  recommend,
  skuMetrics,
  warehouseStock,
  type AffiliateSkuMetrics,
  type Movement,
  type Proposal,
} from "@/lib/affiliates/allocation";

/**
 * Affiliate (Shopee HSL) read model (Phase 5). Quantities are internal SKU
 * units (listing units × units per listing). Tenant isolation: every query is
 * scoped to session.organization.id.
 */

export type AffiliateRow = {
  id: string;
  username: string;
  name: string;
  status: "aktif" | "nonaktif";
  notes: string | null;
  gmv: number;
  units: number;
  commission: number | null;
  velocity: number;
  locked: number;
  sellThrough: number | null;
  daysOfCover: number | null;
  oversold: boolean;
  skus: AffiliateSkuMetrics[];
};

export type AllocationRow = {
  id: string;
  affiliateId: string;
  affiliateName: string;
  sku: string;
  status: "diusulkan" | "disetujui" | "diterapkan" | "ditolak";
  proposedQty: number;
  approvedQty: number | null;
  basis: Record<string, number | boolean> | null;
  proposedAt: string;
  decidedAt: string | null;
  appliedAt: string | null;
};

export type AffiliatesOverview =
  | { status: "empty"; settings: AllocationSettings }
  | {
      status: "ok";
      asOf: string;
      dataFrom: string;
      range: ResolvedRange;
      settings: AllocationSettings;
      affiliates: AffiliateRow[];
      stock: { sku: string; warehouse: number; locked: number; reserved: number }[];
      recommendations: (Proposal & { affiliateName: string })[];
      idle: (AffiliateSkuMetrics & { affiliateName: string })[];
      allocations: AllocationRow[];
      unmappedGmv: number;
      lastImportAt: string | null;
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

export async function getAffiliatesOverview(
  session: ActiveSession,
  input: RangeInput,
  { today = todayInTimeZone(session.organization.timezone) }: { today?: string } = {},
): Promise<AffiliatesOverview> {
  if (!hasRole(session.role, "viewer")) throw new AuthorizationError("viewer");
  const org = session.organization.id;
  return guarded("affiliates", async () => {
    const [bounds, kpi] = await Promise.all([
      queryOne<{ first: Date | string | null; last: Date | string | null }>(
        `SELECT MIN(fact_date) AS first, MAX(fact_date) AS last
           FROM hsl_sales_facts WHERE organization_id = ? AND fact_date <= ?`,
        [org, today],
      ),
      getKpiSettings(session),
    ]);
    const settings = kpi.allocation;
    if (!bounds?.last || !bounds.first) return { status: "empty", settings };
    const asOf = iso(bounds.last);
    const range = resolveRange(input, asOf, kpi.defaultRange);
    const windowFrom = addDays(asOf, -(settings.windowDays - 1));

    const [affiliates, sales, movements, allocations, unmapped, lastImport] = await Promise.all([
      queryRows<{ id: string; username: string; name: string; status: "aktif" | "nonaktif"; notes: string | null }>(
        "SELECT id, username, name, status, notes FROM affiliates WHERE organization_id = ? ORDER BY name",
        [org],
      ),
      queryRows<{
        affiliate_id: string;
        sku: string;
        sold_total: string | number;
        sold_window: string | number;
        sold_period: string | number;
        gmv_period: string | number;
        commission_period: string | number | null;
      }>(
        `SELECT f.affiliate_id, v.sku,
                SUM(f.units_sold * l.units_per_listing) AS sold_total,
                SUM(CASE WHEN f.fact_date BETWEEN ? AND ? THEN f.units_sold * l.units_per_listing ELSE 0 END) AS sold_window,
                SUM(CASE WHEN f.fact_date BETWEEN ? AND ? THEN f.units_sold * l.units_per_listing ELSE 0 END) AS sold_period,
                SUM(CASE WHEN f.fact_date BETWEEN ? AND ? THEN f.gmv ELSE 0 END) AS gmv_period,
                SUM(CASE WHEN f.fact_date BETWEEN ? AND ? THEN f.commission END) AS commission_period
           FROM hsl_sales_facts f
           JOIN channel_listings l ON l.organization_id = f.organization_id AND l.id = f.listing_id
           JOIN product_variants v ON v.organization_id = l.organization_id AND v.id = l.variant_id
          WHERE f.organization_id = ? AND f.fact_date <= ?
          GROUP BY f.affiliate_id, v.sku`,
        [windowFrom, asOf, range.from, range.to, range.from, range.to, range.from, range.to, org, asOf],
      ),
      queryRows<{
        sku: string;
        affiliate_id: string | null;
        movement_type: Movement["type"];
        quantity: number;
        sign_adjust: number;
      }>(
        `SELECT v.sku, m.affiliate_id, m.movement_type, m.quantity, m.sign_adjust
           FROM inventory_movements m JOIN product_variants v ON v.organization_id = m.organization_id AND v.id = m.variant_id
          WHERE m.organization_id = ?`,
        [org],
      ),
      queryRows<{
        id: string;
        affiliate_id: string;
        sku: string;
        status: AllocationRow["status"];
        proposed_qty: number;
        approved_qty: number | null;
        basis: unknown;
        proposed_at: Date;
        decided_at: Date | null;
        applied_at: Date | null;
      }>(
        `SELECT a.id, a.affiliate_id, v.sku, a.status, a.proposed_qty, a.approved_qty, a.basis, a.proposed_at,
                a.decided_at, a.applied_at
           FROM hsl_allocations a JOIN product_variants v ON v.organization_id = a.organization_id AND v.id = a.variant_id
          WHERE a.organization_id = ?
          ORDER BY FIELD(a.status, 'diusulkan', 'disetujui', 'diterapkan', 'ditolak'), a.proposed_at DESC
          LIMIT 100`,
        [org],
      ),
      queryOne<{ gmv: string | number | null }>(
        `SELECT SUM(f.gmv) AS gmv FROM hsl_sales_facts f
           JOIN channel_listings l ON l.organization_id = f.organization_id AND l.id = f.listing_id
          WHERE f.organization_id = ? AND l.variant_id IS NULL AND f.fact_date BETWEEN ? AND ?`,
        [org, range.from, range.to],
      ),
      queryOne<{ at: Date | null }>(
        `SELECT MAX(committed_at) AS at FROM import_batches
          WHERE organization_id = ? AND status = 'committed' AND report_type = 'shopee_hsl_affiliate'`,
        [org],
      ),
    ]);

    const moves: Movement[] = movements.map((m) => ({
      sku: m.sku,
      affiliateId: m.affiliate_id,
      type: m.movement_type,
      quantity: m.quantity,
      sign: m.sign_adjust < 0 ? -1 : 1,
    }));
    const warehouse = warehouseStock(moves);
    const consignedMap = consigned(moves);
    const name = new Map(affiliates.map((a) => [a.id, a.name]));

    // Every affiliate × SKU with sales or consigned stock.
    const keys = new Set([...sales.map((s) => `${s.affiliate_id}|${s.sku}`), ...consignedMap.keys()]);
    const salesBy = new Map(sales.map((s) => [`${s.affiliate_id}|${s.sku}`, s]));
    const metrics = [...keys].map((k) => {
      const [affiliateId, sku] = k.split("|");
      const s = salesBy.get(k);
      return skuMetrics(
        {
          affiliateId,
          sku,
          soldTotal: n(s?.sold_total ?? 0),
          soldWindow: n(s?.sold_window ?? 0),
          soldPeriod: n(s?.sold_period ?? 0),
          consigned: consignedMap.get(k) ?? 0,
        },
        settings.windowDays,
      );
    });

    const reserved = new Map<string, number>();
    for (const a of allocations) {
      if (a.status === "disetujui") reserved.set(a.sku, (reserved.get(a.sku) ?? 0) + (a.approved_qty ?? 0));
    }
    const active = new Set(affiliates.filter((a) => a.status === "aktif").map((a) => a.id));

    const rows: AffiliateRow[] = affiliates
      .map((a) => {
        const own = metrics.filter((m) => m.affiliateId === a.id);
        const own_sales = sales.filter((s) => s.affiliate_id === a.id);
        const units = own.reduce((s, m) => s + m.soldPeriod, 0);
        const locked = own.reduce((s, m) => s + m.locked, 0);
        const velocity = own.reduce((s, m) => s + m.velocity, 0);
        const commissions = own_sales.map((s) => s.commission_period);
        return {
          ...a,
          gmv: own_sales.reduce((s, x) => s + n(x.gmv_period), 0),
          units,
          commission: commissions.some((c) => c !== null) ? commissions.reduce<number>((s, c) => s + n(c), 0) : null,
          velocity,
          locked,
          sellThrough: units + locked > 0 ? units / (units + locked) : null,
          daysOfCover: velocity > 0 ? locked / velocity : null,
          oversold: own.some((m) => m.oversold),
          skus: own.sort((x, y) => y.velocity - x.velocity),
        };
      })
      .sort((a, b) => b.gmv - a.gmv);

    const skus = new Set([...warehouse.keys(), ...metrics.map((m) => m.sku)]);
    return {
      status: "ok",
      asOf,
      dataFrom: iso(bounds.first),
      range,
      settings,
      affiliates: rows,
      stock: [...skus].sort().map((sku) => ({
        sku,
        warehouse: warehouse.get(sku) ?? 0,
        locked: metrics.filter((m) => m.sku === sku).reduce((s, m) => s + m.locked, 0),
        reserved: reserved.get(sku) ?? 0,
      })),
      recommendations: recommend(
        metrics.filter((m) => active.has(m.affiliateId)),
        warehouse,
        settings.coverDays,
        reserved,
      ).map((p) => ({ ...p, affiliateName: name.get(p.affiliateId) ?? p.affiliateId })),
      idle: idleStock(metrics, settings.coverDays).map((m) => ({
        ...m,
        affiliateName: name.get(m.affiliateId) ?? m.affiliateId,
      })),
      allocations: allocations.map((a) => ({
        id: a.id,
        affiliateId: a.affiliate_id,
        affiliateName: name.get(a.affiliate_id) ?? a.affiliate_id,
        sku: a.sku,
        status: a.status,
        proposedQty: a.proposed_qty,
        approvedQty: a.approved_qty,
        basis: (typeof a.basis === "string" ? JSON.parse(a.basis) : a.basis) as AllocationRow["basis"],
        proposedAt: a.proposed_at.toISOString(),
        decidedAt: a.decided_at ? a.decided_at.toISOString() : null,
        appliedAt: a.applied_at ? a.applied_at.toISOString() : null,
      })),
      unmappedGmv: n(unmapped?.gmv ?? null),
      lastImportAt: lastImport?.at ? lastImport.at.toISOString() : null,
    };
  });
}
