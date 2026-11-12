/**
 * Phase 5 — Afiliasi HSL (pure, no I/O).
 *
 * Stock ledger (quantities in internal SKU units):
 *   warehouse(sku)       = masuk ± penyesuaian − alokasi + retur
 *   locked(aff, sku)     = alokasi − retur − HSL units sold        (never below 0 in reports)
 * Metrics for an affiliate × SKU:
 *   velocity             = units sold in the last `windowDays` ÷ windowDays
 *   sell-through         = sold in period ÷ (sold in period + locked now)
 *   days of cover        = locked ÷ velocity
 * Recommendation:
 *   target               = ceil(velocity × coverDays)
 *   proposal             = target − locked (if > 0), allocated best-velocity first and
 *                          capped by the warehouse stock still free → never above stock.
 */

export type Movement = {
  sku: string;
  affiliateId: string | null;
  type: "masuk" | "penyesuaian" | "alokasi" | "retur";
  quantity: number;
  sign: 1 | -1;
};

export function warehouseStock(movements: Movement[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of movements) {
    const delta =
      m.type === "masuk"
        ? m.quantity
        : m.type === "penyesuaian"
          ? m.quantity * m.sign
          : m.type === "alokasi"
            ? -m.quantity
            : m.quantity;
    out.set(m.sku, (out.get(m.sku) ?? 0) + delta);
  }
  return out;
}

const key = (affiliateId: string, sku: string) => `${affiliateId}|${sku}`;

/** Allocated − returned per affiliate × SKU (before subtracting sales). */
export function consigned(movements: Movement[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of movements) {
    if (!m.affiliateId || (m.type !== "alokasi" && m.type !== "retur")) continue;
    const k = key(m.affiliateId, m.sku);
    out.set(k, (out.get(k) ?? 0) + (m.type === "alokasi" ? m.quantity : -m.quantity));
  }
  return out;
}

export type AffiliateSku = {
  affiliateId: string;
  sku: string;
  /** All HSL units sold to date (SKU units). */
  soldTotal: number;
  /** Units sold in the velocity window. */
  soldWindow: number;
  /** Units sold in the reporting period. */
  soldPeriod: number;
  consigned: number;
};

export type AffiliateSkuMetrics = AffiliateSku & {
  locked: number;
  /** True when sales exceed the consigned stock (data gap: allocations not recorded). */
  oversold: boolean;
  velocity: number;
  sellThrough: number | null;
  daysOfCover: number | null;
};

export function skuMetrics(row: AffiliateSku, windowDays: number): AffiliateSkuMetrics {
  const raw = row.consigned - row.soldTotal;
  const locked = Math.max(0, raw);
  const velocity = row.soldWindow / windowDays;
  return {
    ...row,
    locked,
    oversold: raw < 0,
    velocity,
    sellThrough: row.soldPeriod + locked > 0 ? row.soldPeriod / (row.soldPeriod + locked) : null,
    daysOfCover: velocity > 0 ? locked / velocity : null,
  };
}

export type Proposal = {
  affiliateId: string;
  sku: string;
  velocity: number;
  locked: number;
  target: number;
  need: number;
  quantity: number;
  /** Quantity cut because warehouse stock ran out. */
  capped: boolean;
};

export function recommend(
  rows: AffiliateSkuMetrics[],
  warehouse: Map<string, number>,
  coverDays: number,
  /** Stock already promised to approved-but-not-applied allocations. */
  reserved: Map<string, number> = new Map(),
): Proposal[] {
  const free = new Map([...warehouse].map(([sku, q]) => [sku, Math.max(0, q - (reserved.get(sku) ?? 0))]));
  const out: Proposal[] = [];
  for (const r of [...rows].sort((a, b) => b.velocity - a.velocity)) {
    if (r.velocity <= 0) continue;
    const target = Math.ceil(r.velocity * coverDays);
    const need = target - r.locked;
    if (need <= 0) continue;
    const available = free.get(r.sku) ?? 0;
    const quantity = Math.min(need, available);
    free.set(r.sku, available - quantity);
    out.push({
      affiliateId: r.affiliateId,
      sku: r.sku,
      velocity: r.velocity,
      locked: r.locked,
      target,
      need,
      quantity,
      capped: quantity < need,
    });
  }
  return out;
}

/** Stock sitting with an affiliate that does not move (candidate for a return). */
export function idleStock(rows: AffiliateSkuMetrics[], coverDays: number): AffiliateSkuMetrics[] {
  return rows.filter((r) => r.locked > 0 && (r.velocity === 0 || (r.daysOfCover ?? 0) > coverDays * 3));
}
