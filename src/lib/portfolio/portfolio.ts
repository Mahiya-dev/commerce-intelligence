import { addMonths, daysInMonth, monthEnd, monthStart, ratio } from "@/lib/ecommerce/kpi";
import type { PortfolioThresholds } from "@/lib/organization/settings";
import { TOUCHPOINT_LABELS, type Touchpoint } from "@/lib/imports/templates";

/**
 * Portfolio math (pure, no I/O) for Phase 3 — Portofolio Produk.
 *
 * Unit of analysis: internal SKU (product variant; a bundle is its own SKU).
 * Listings not mapped to a SKU are excluded from the matrix and reported apart.
 *
 * Internal portfolio matrix for a month M (BCG-style, but on INTERNAL data —
 * not the classic BCG, which needs external market share):
 *   share(sku)  = GMV(sku, M) ÷ GMV(all mapped SKUs, M)
 *   growth(sku) = GMV(sku, M) ÷ GMV(sku, M−1) − 1
 *                 (the current month uses the equivalent period: days 1..N vs 1..N)
 *   high share  ⇔ share  ≥ shareFactor × (1 ÷ SKUs with GMV in M)
 *   high growth ⇔ growth ≥ growthThreshold
 *
 *   Bintang   = high share  + high growth
 *   Penopang  = high share  + low growth
 *   Potensial = low share   + high growth
 *   Evaluasi  = low share   + low growth
 *   Baru      = sold in M but nothing in M−1 (no growth to compare)
 */

export type Quadrant = "bintang" | "penopang" | "potensial" | "evaluasi" | "baru";

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  bintang: "Bintang",
  penopang: "Penopang",
  potensial: "Potensial",
  evaluasi: "Evaluasi",
  baru: "Baru",
};

export const QUADRANT_DESCRIPTIONS: Record<Quadrant, string> = {
  bintang: "Porsi GMV besar dan tumbuh",
  penopang: "Porsi GMV besar, pertumbuhan rendah",
  potensial: "Porsi GMV kecil, tumbuh",
  evaluasi: "Porsi GMV kecil dan tidak tumbuh",
  baru: "Belum ada penjualan bulan sebelumnya",
};

/** Daily facts aggregated per internal SKU (units = SKU units = listing units × units per listing). */
export type SkuDailyFact = {
  sku: string;
  date: string;
  gmv: number;
  orders: number;
  units: number;
  visitors: number | null;
  clicks: number | null;
};

export type Period = { from: string; to: string };

export type SkuTotals = {
  gmv: number;
  orders: number;
  units: number;
  /** null when no row in the period reported it (missing ≠ 0). */
  visitors: number | null;
  clicks: number | null;
  aov: number | null;
  /** orders ÷ product visitors */
  conversionRate: number | null;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Period of month `month` (YYYY-MM) as of `asOf`, and its comparison period. */
export function monthPeriods(month: string, asOf: string): { period: Period; compare: Period; isPartial: boolean } {
  const start = `${month}-01`;
  const prevStart = addMonths(start, -1);
  if (month === asOf.slice(0, 7)) {
    const day = Number(asOf.slice(8, 10));
    const prevDay = Math.min(day, daysInMonth(prevStart));
    return {
      period: { from: start, to: asOf },
      compare: { from: prevStart, to: `${prevStart.slice(0, 8)}${pad(prevDay)}` },
      isPartial: asOf !== monthEnd(asOf),
    };
  }
  return {
    period: { from: start, to: monthEnd(start) },
    compare: { from: prevStart, to: monthEnd(prevStart) },
    isPartial: false,
  };
}

/** The `count` months ending with the as-of month, oldest first. */
export function monthsUpTo(asOf: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(monthStart(asOf), -(count - 1 - i)).slice(0, 7));
}

const sumNullable = (values: (number | null)[]) =>
  values.some((v) => v !== null) ? values.reduce<number>((s, v) => s + (v ?? 0), 0) : null;

export function skuTotals(facts: SkuDailyFact[]): SkuTotals {
  const gmv = facts.reduce((s, f) => s + f.gmv, 0);
  const orders = facts.reduce((s, f) => s + f.orders, 0);
  const visitors = sumNullable(facts.map((f) => f.visitors));
  return {
    gmv,
    orders,
    units: facts.reduce((s, f) => s + f.units, 0),
    visitors,
    clicks: sumNullable(facts.map((f) => f.clicks)),
    aov: ratio(gmv, orders),
    conversionRate: visitors === null ? null : ratio(orders, visitors),
  };
}

const inPeriod = (d: string, p: Period) => d >= p.from && d <= p.to;

export type MatrixRow = {
  sku: string;
  current: SkuTotals;
  previous: SkuTotals;
  share: number;
  growth: number | null;
  quadrant: Quadrant;
};

export type Matrix = {
  month: string;
  period: Period;
  compare: Period;
  isPartial: boolean;
  totalGmv: number;
  activeSkus: number;
  /** Share a SKU needs to count as "high share". */
  shareThreshold: number | null;
  growthThreshold: number;
  rows: MatrixRow[];
};

export function quadrantFor(
  share: number,
  growth: number | null,
  shareThreshold: number,
  growthThreshold: number,
): Quadrant {
  if (growth === null) return "baru";
  const highShare = share >= shareThreshold;
  const highGrowth = growth >= growthThreshold;
  if (highShare) return highGrowth ? "bintang" : "penopang";
  return highGrowth ? "potensial" : "evaluasi";
}

/** Matrix for one month. Only SKUs with GMV in the month are classified. */
export function buildMatrix(
  facts: SkuDailyFact[],
  month: string,
  asOf: string,
  thresholds: PortfolioThresholds,
): Matrix {
  const { period, compare, isPartial } = monthPeriods(month, asOf);
  const cur = new Map<string, SkuDailyFact[]>();
  const prev = new Map<string, SkuDailyFact[]>();
  for (const f of facts) {
    const bucket = inPeriod(f.date, period) ? cur : inPeriod(f.date, compare) ? prev : null;
    if (!bucket) continue;
    const list = bucket.get(f.sku) ?? [];
    list.push(f);
    bucket.set(f.sku, list);
  }
  const totals = [...cur.entries()]
    .map(([sku, list]) => ({ sku, current: skuTotals(list), previous: skuTotals(prev.get(sku) ?? []) }))
    .filter((r) => r.current.gmv > 0);
  const totalGmv = totals.reduce((s, r) => s + r.current.gmv, 0);
  const activeSkus = totals.length;
  const shareThreshold = activeSkus ? thresholds.shareFactor / activeSkus : null;

  const rows = totals
    .map((r) => {
      const share = r.current.gmv / totalGmv;
      const growth = r.previous.gmv > 0 ? r.current.gmv / r.previous.gmv - 1 : null;
      return { ...r, share, growth, quadrant: quadrantFor(share, growth, shareThreshold!, thresholds.growthThreshold) };
    })
    .sort((a, b) => b.current.gmv - a.current.gmv);

  return {
    month,
    period,
    compare,
    isPartial,
    totalGmv,
    activeSkus,
    shareThreshold,
    growthThreshold: thresholds.growthThreshold,
    rows,
  };
}

/** Quadrant of every SKU in every month (null = no sales that month). */
export function quadrantHistory(
  facts: SkuDailyFact[],
  months: string[],
  asOf: string,
  thresholds: PortfolioThresholds,
): { months: string[]; bySku: Map<string, (Quadrant | null)[]>; matrices: Matrix[] } {
  const matrices = months.map((m) => buildMatrix(facts, m, asOf, thresholds));
  const skus = new Set(matrices.flatMap((mx) => mx.rows.map((r) => r.sku)));
  const bySku = new Map<string, (Quadrant | null)[]>();
  for (const sku of skus) {
    bySku.set(
      sku,
      matrices.map((mx) => mx.rows.find((r) => r.sku === sku)?.quadrant ?? null),
    );
  }
  return { months, bySku, matrices };
}

/** Monthly totals of one SKU (oldest first); partial current month flagged. */
export function monthlyTrend(facts: SkuDailyFact[], months: string[], asOf: string) {
  return months.map((month) => {
    const { period, isPartial } = monthPeriods(month, asOf);
    return { month, isPartial, ...skuTotals(facts.filter((f) => inPeriod(f.date, period))) };
  });
}

// ---- touchpoints & recommendations ------------------------------------------------

export type TouchpointTotals = {
  touchpoint: Touchpoint;
  gmv: number;
  orders: number;
  /** null when no cost was reported (organik/video, or not provided). */
  cost: number | null;
  /** GMV ÷ cost; null without cost. */
  roas: number | null;
  share: number;
  previousGmv: number;
  growth: number | null;
};

export type TouchpointFact = {
  sku: string;
  touchpoint: Touchpoint;
  date: string;
  gmv: number;
  orders: number;
  cost: number | null;
};

export function touchpointBreakdown(facts: TouchpointFact[], period: Period, compare: Period): TouchpointTotals[] {
  const by = new Map<Touchpoint, { gmv: number; orders: number; costs: (number | null)[]; prev: number }>();
  for (const f of facts) {
    const cur = inPeriod(f.date, period);
    if (!cur && !inPeriod(f.date, compare)) continue;
    const t = by.get(f.touchpoint) ?? { gmv: 0, orders: 0, costs: [], prev: 0 };
    if (cur) {
      t.gmv += f.gmv;
      t.orders += f.orders;
      t.costs.push(f.cost);
    } else {
      t.prev += f.gmv;
    }
    by.set(f.touchpoint, t);
  }
  const total = [...by.values()].reduce((s, t) => s + t.gmv, 0);
  return [...by.entries()]
    .map(([touchpoint, t]) => {
      const cost = sumNullable(t.costs);
      return {
        touchpoint,
        gmv: t.gmv,
        orders: t.orders,
        cost,
        roas: cost ? t.gmv / cost : null,
        share: total ? t.gmv / total : 0,
        previousGmv: t.prev,
        growth: t.prev > 0 ? t.gmv / t.prev - 1 : null,
      };
    })
    .filter((t) => t.gmv > 0 || t.previousGmv > 0)
    .sort((a, b) => b.gmv - a.gmv);
}

/** A touchpoint with cost whose ROAS is below this pays back less than 2× its cost. */
export const ROAS_FLOOR = 2;
/** Touchpoint growth worth calling out (and minimum share to matter). */
export const TOUCHPOINT_GROWTH_NOTE = 0.3;
export const TOUCHPOINT_MIN_SHARE = 0.1;

export type Recommendation = { priority: "tinggi" | "sedang" | "info"; title: string; detail: string };

const pct = (v: number) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(Math.abs(v) * 100)}%`;
const share = (v: number) => `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(v * 100)}%`;
const roasText = (v: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(v);
const label = (t: Touchpoint) => TOUCHPOINT_LABELS[t];

/**
 * Rule-based recommendations for one SKU. Every recommendation states the
 * numbers it is based on (evidence), so it can be checked.
 */
export function recommend(
  row: Pick<MatrixRow, "quadrant" | "share" | "growth">,
  touchpoints: TouchpointTotals[],
  previousQuadrant: Quadrant | null,
): Recommendation[] {
  const out: Recommendation[] = [];
  const paid = touchpoints.filter((t) => t.roas !== null && t.gmv > 0);
  const bestPaid = [...paid].sort((a, b) => b.roas! - a.roas!)[0];
  const worstPaid = [...paid].sort((a, b) => a.roas! - b.roas!)[0];
  const fastest = touchpoints
    .filter((t) => t.growth !== null && t.share >= TOUCHPOINT_MIN_SHARE)
    .sort((a, b) => b.growth! - a.growth!)[0];
  const growthText = row.growth === null ? "belum ada pembanding" : `pertumbuhan ${pct(row.growth)}`;
  const evidence = `Porsi GMV ${share(row.share)}, ${growthText}.`;

  switch (row.quadrant) {
    case "bintang":
      out.push({
        priority: "tinggi",
        title: "Skalakan: jaga stok dan perbesar touchpoint terbaik",
        detail:
          `${evidence} ` +
          (bestPaid
            ? `Touchpoint berbayar paling efisien: ${label(bestPaid.touchpoint)} (ROAS ${roasText(bestPaid.roas!)}).`
            : "Belum ada data biaya touchpoint untuk memilih kanal skala."),
      });
      break;
    case "penopang":
      out.push({
        priority: "sedang",
        title: "Pertahankan dan efisienkan biaya",
        detail:
          `${evidence} SKU penyumbang besar dengan pertumbuhan rendah. ` +
          (worstPaid
            ? `Tinjau ${label(worstPaid.touchpoint)} (ROAS ${roasText(worstPaid.roas!)}) sebelum menambah anggaran.`
            : "Fokus pada margin dan ketersediaan stok."),
      });
      break;
    case "potensial":
      out.push({
        priority: "tinggi",
        title: "Dorong pertumbuhan lewat touchpoint yang sedang naik",
        detail:
          `${evidence} ` +
          (fastest
            ? `${label(fastest.touchpoint)} tumbuh ${pct(fastest.growth!)} dan menyumbang ${share(fastest.share)} GMV SKU ini.`
            : "Uji touchpoint baru (live/afiliasi) dengan anggaran terbatas."),
      });
      break;
    case "evaluasi":
      out.push({
        priority: "sedang",
        title: "Evaluasi: kurangi biaya yang tidak efisien atau ubah penawaran",
        detail:
          `${evidence} Pertimbangkan bundel, penyesuaian harga, atau mengurangi listing. ` +
          (worstPaid ? `ROAS terendah: ${label(worstPaid.touchpoint)} (${roasText(worstPaid.roas!)}).` : ""),
      });
      break;
    case "baru":
      out.push({
        priority: "info",
        title: "Pantau satu bulan penuh",
        detail: "Belum ada penjualan bulan sebelumnya sehingga pertumbuhan belum bisa dihitung.",
      });
      break;
  }

  for (const t of paid) {
    if (t.roas! < ROAS_FLOOR) {
      out.push({
        priority: "tinggi",
        title: `Biaya ${label(t.touchpoint)} hampir tidak kembali`,
        detail: `ROAS ${roasText(t.roas!)}: biaya Rp${t.cost!.toLocaleString("id-ID")} untuk GMV Rp${t.gmv.toLocaleString("id-ID")} (batas ${ROAS_FLOOR}).`,
      });
    }
  }
  if (fastest && fastest.growth! >= TOUCHPOINT_GROWTH_NOTE && row.quadrant !== "potensial") {
    out.push({
      priority: "info",
      title: `${label(fastest.touchpoint)} sedang naik`,
      detail: `GMV dari ${label(fastest.touchpoint)} tumbuh ${pct(fastest.growth!)} (porsi ${share(fastest.share)}).`,
    });
  }
  const strong = (q: Quadrant | null) => q === "bintang" || q === "penopang";
  if (strong(previousQuadrant) && (row.quadrant === "evaluasi" || row.quadrant === "potensial")) {
    out.push({
      priority: "tinggi",
      title: `Turun kuadran: ${QUADRANT_LABELS[previousQuadrant!]} → ${QUADRANT_LABELS[row.quadrant]}`,
      detail:
        "Porsi GMV turun di bawah ambang dibanding bulan sebelumnya; periksa stok, harga dan visibilitas listing.",
    });
  }
  return out;
}
