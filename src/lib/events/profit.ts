/**
 * Phase 5 — event profitability (pure, no I/O).
 *
 *   Revenue            = net revenue of event sales (+ post-event sales within the attribution window)
 *   COGS               = Σ units × unit COGS effective on the sale date
 *   Gross profit       = Revenue − COGS
 *   Contribution       = Revenue − COGS − variable costs
 *   Net event profit   = Contribution − fixed costs
 *   Contribution margin= Contribution ÷ Revenue
 *   Break-even revenue = fixed costs ÷ contribution margin   (null when margin ≤ 0: cannot break even)
 *   ROI                = Net profit ÷ (COGS + variable + fixed costs)
 *
 * Profit is never derived from gross revenue alone: when any sold unit has no
 * known COGS, COGS and every figure that depends on it are null (incomplete).
 */

export type EventSale = {
  variantId: string;
  sku: string;
  soldOn: string;
  units: number;
  revenue: number;
  phase: "event" | "pasca_event";
};

export type EventCost = { costType: "tetap" | "variabel"; amount: number };

export type CogsLookup = (variantId: string, date: string) => number | null;

export type EventWindow = { startDate: string; endDate: string; attributionDays: number };

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Last day a post-event sale still counts toward the event. */
export function attributionEnd(w: EventWindow): string {
  return addDays(w.endDate, w.attributionDays);
}

/** Whether a sale counts: event sales inside the event dates, post-event sales inside the window. */
export function counts(sale: Pick<EventSale, "soldOn" | "phase">, w: EventWindow): boolean {
  if (sale.phase === "event") return sale.soldOn >= w.startDate && sale.soldOn <= w.endDate;
  return sale.soldOn > w.endDate && sale.soldOn <= attributionEnd(w);
}

export type Financials = {
  revenue: number;
  units: number;
  cogs: number | null;
  grossProfit: number | null;
  variableCosts: number;
  fixedCosts: number;
  contribution: number | null;
  contributionMargin: number | null;
  netProfit: number | null;
  breakEvenRevenue: number | null;
  /** Revenue still needed to break even (0 when already above). */
  breakEvenGap: number | null;
  roi: number | null;
  /** SKUs sold without a known COGS (make every profit figure null). */
  missingCogs: string[];
};

export function financials(sales: EventSale[], costs: EventCost[], cogsOf: CogsLookup): Financials {
  const revenue = sales.reduce((s, x) => s + x.revenue, 0);
  const units = sales.reduce((s, x) => s + x.units, 0);
  let cogsTotal = 0;
  const missing = new Set<string>();
  for (const s of sales) {
    const unit = cogsOf(s.variantId, s.soldOn);
    if (unit === null) missing.add(s.sku);
    else cogsTotal += unit * s.units;
  }
  const variableCosts = costs.filter((c) => c.costType === "variabel").reduce((s, c) => s + c.amount, 0);
  const fixedCosts = costs.filter((c) => c.costType === "tetap").reduce((s, c) => s + c.amount, 0);
  const cogs = missing.size ? null : Math.round(cogsTotal);
  const grossProfit = cogs === null ? null : revenue - cogs;
  const contribution = grossProfit === null ? null : grossProfit - variableCosts;
  const contributionMargin = contribution === null || revenue === 0 ? null : contribution / revenue;
  const netProfit = contribution === null ? null : contribution - fixedCosts;
  const breakEvenRevenue =
    contributionMargin === null || contributionMargin <= 0 ? null : Math.ceil(fixedCosts / contributionMargin);
  const invested = cogs === null ? null : cogs + variableCosts + fixedCosts;
  return {
    revenue,
    units,
    cogs,
    grossProfit,
    variableCosts,
    fixedCosts,
    contribution,
    contributionMargin,
    netProfit,
    breakEvenRevenue,
    breakEvenGap: breakEvenRevenue === null ? null : Math.max(0, breakEvenRevenue - revenue),
    roi: netProfit === null || !invested ? null : netProfit / invested,
    missingCogs: [...missing].sort(),
  };
}

// ---- COGS lookup ------------------------------------------------------------------

export type CogsHistory = { variantId: string; effectiveFrom: string; unitCogs: number }[];
export type BundleComponents = Map<string, { componentId: string; quantity: number }[]>;

/**
 * Unit COGS on a date: the latest history entry effective on/before the date,
 * else the variant's standard COGS; a bundle without its own COGS is the sum of
 * its components. Null when unknown.
 */
export function cogsLookup(
  history: CogsHistory,
  standard: Map<string, number | null>,
  bundles: BundleComponents,
): CogsLookup {
  const byVariant = new Map<string, { from: string; cogs: number }[]>();
  for (const h of history) {
    const list = byVariant.get(h.variantId) ?? [];
    list.push({ from: h.effectiveFrom, cogs: h.unitCogs });
    byVariant.set(h.variantId, list);
  }
  for (const list of byVariant.values()) list.sort((a, b) => (a.from < b.from ? 1 : -1));

  const own = (variantId: string, date: string): number | null => {
    const hit = byVariant.get(variantId)?.find((h) => h.from <= date);
    if (hit) return hit.cogs;
    return standard.get(variantId) ?? null;
  };
  const lookup: CogsLookup = (variantId, date) => {
    const direct = own(variantId, date);
    if (direct !== null) return direct;
    const parts = bundles.get(variantId);
    if (!parts?.length) return null;
    let sum = 0;
    for (const p of parts) {
      const c = own(p.componentId, date);
      if (c === null) return null;
      sum += c * p.quantity;
    }
    return sum;
  };
  return lookup;
}

// ---- leads ------------------------------------------------------------------------

export type LeadEntry = { leads: number; converted: number };

export function leadSummary(entries: LeadEntry[]) {
  const leads = entries.reduce((s, e) => s + e.leads, 0);
  const converted = entries.reduce((s, e) => s + e.converted, 0);
  return { leads, converted, conversionRate: leads ? converted / leads : null };
}
