/**
 * Pure e-commerce KPI math (no I/O). Formulas mirror the answer key
 * "Kunci Jawaban" in samples/phase-2/Contoh_Data_DEMO_Sep-Nov2026.xlsx and are
 * unit-tested against samples/phase-2/expected.json:
 *
 *   AOV              = GMV ÷ orders
 *   Conversion rate  = orders ÷ visitors (same formula for every channel)
 *   MoM (equivalent) = days 1–N this month vs days 1–N last month (N = as-of day,
 *                      capped at the length of last month)
 *   Expected MTD     = target × elapsed days ÷ days in month (linear)
 *   Progress         = GMV MTD ÷ expected MTD → status
 *   Run rate needed  = max(0, target − GMV MTD) ÷ remaining days
 *   Forecast         = GMV MTD ÷ elapsed days × days in month (linear run rate)
 *                      (so forecast ÷ target always equals progress; not shown twice)
 *
 * A ratio with a zero denominator is null ("—"), never 0.
 */

/** Progress thresholds — interpretation pending business confirmation (docs/architecture.md §8 #11). */
export const STATUS_THRESHOLDS = { onTrack: 0.9, watch: 0.7 } as const;

export type TargetStatus = "on_track" | "watch" | "at_risk";

export type DailyFact = {
  channel: string;
  /** YYYY-MM-DD */
  date: string;
  gmv: number;
  orders: number;
  units: number;
  visitors: number;
};

export type Totals = {
  /** Distinct channel-days with data. */
  days: number;
  gmv: number;
  orders: number;
  units: number;
  visitors: number;
  aov: number | null;
  conversionRate: number | null;
};

export const ratio = (a: number, b: number): number | null => (b === 0 ? null : a / b);

export function totals(facts: DailyFact[]): Totals {
  const t = { days: facts.length, gmv: 0, orders: 0, units: 0, visitors: 0 };
  for (const f of facts) {
    t.gmv += f.gmv;
    t.orders += f.orders;
    t.units += f.units;
    t.visitors += f.visitors;
  }
  return { ...t, aov: ratio(t.gmv, t.orders), conversionRate: ratio(t.orders, t.visitors) };
}

// ---- calendar helpers (UTC calendar dates, no time-of-day) --------------------

const parse = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, day };
};
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (y: number, m: number, day: number) => `${y}-${pad(m)}-${pad(day)}`;

export function daysInMonth(date: string): number {
  const { y, m } = parse(date);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthStart(date: string): string {
  const { y, m } = parse(date);
  return fmt(y, m, 1);
}

/** First day of the month `offset` months away from `date`'s month. */
export function addMonths(date: string, offset: number): string {
  const { y, m } = parse(date);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return fmt(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export function monthEnd(date: string): string {
  const start = monthStart(date);
  return fmt(parse(start).y, parse(start).m, daysInMonth(start));
}

const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

// ---- KPIs --------------------------------------------------------------------

export type ChannelTotals = { channel: string; totals: Totals };

/** Totals per channel (in `channels` order) plus the all-channel total. */
export function byChannel(facts: DailyFact[], channels: string[]): { rows: ChannelTotals[]; all: Totals } {
  return {
    rows: channels.map((channel) => ({ channel, totals: totals(facts.filter((f) => f.channel === channel)) })),
    all: totals(facts),
  };
}

export type MonthSummary = { month: string; from: string; to: string; isPartial: boolean } & ReturnType<
  typeof byChannel
>;

/** Month-by-month summary for the `months` months ending with the as-of month. */
export function monthlySummary(facts: DailyFact[], channels: string[], asOf: string, months = 3): MonthSummary[] {
  const out: MonthSummary[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const from = addMonths(asOf, -i);
    const to = i === 0 ? asOf : monthEnd(from);
    out.push({
      month: from.slice(0, 7),
      from,
      to,
      isPartial: i === 0 && asOf !== monthEnd(asOf),
      ...byChannel(
        facts.filter((f) => inRange(f.date, from, to)),
        channels,
      ),
    });
  }
  return out;
}

export type MomRow = {
  channel: string | null;
  current: Totals;
  previous: Totals;
  gmvChange: number | null;
  ordersChange: number | null;
  aovChange: number | null;
};

const change = (cur: number | null, prev: number | null) =>
  cur === null || prev === null || prev === 0 ? null : cur / prev - 1;

/** Equivalent-period MoM: 1..N of the as-of month vs 1..N of the previous month. */
export function momEquivalent(facts: DailyFact[], channels: string[], asOf: string) {
  const curFrom = monthStart(asOf);
  const prevFrom = addMonths(asOf, -1);
  const prevTo = fmt(parse(prevFrom).y, parse(prevFrom).m, Math.min(parse(asOf).day, daysInMonth(prevFrom)));
  const cur = facts.filter((f) => inRange(f.date, curFrom, asOf));
  const prev = facts.filter((f) => inRange(f.date, prevFrom, prevTo));
  const row = (channel: string | null): MomRow => {
    const c = totals(channel ? cur.filter((f) => f.channel === channel) : cur);
    const p = totals(channel ? prev.filter((f) => f.channel === channel) : prev);
    return {
      channel,
      current: c,
      previous: p,
      gmvChange: change(c.gmv, p.gmv),
      ordersChange: change(c.orders, p.orders),
      aovChange: change(c.aov, p.aov),
    };
  };
  return {
    current: { from: curFrom, to: asOf },
    previous: { from: prevFrom, to: prevTo },
    rows: channels.map(row),
    all: row(null),
  };
}

export function statusFor(progress: number | null): TargetStatus | null {
  if (progress === null) return null;
  if (progress >= STATUS_THRESHOLDS.onTrack) return "on_track";
  if (progress >= STATUS_THRESHOLDS.watch) return "watch";
  return "at_risk";
}

export type TargetProgress = {
  target: number;
  actual: number;
  expected: number;
  progress: number | null;
  status: TargetStatus | null;
  /** Share of the full-month target already achieved. */
  attainment: number;
  runRateActual: number;
  runRateNeeded: number;
  forecast: number;
};

export function targetProgress(target: number, actualMtd: number, asOf: string): TargetProgress {
  const dim = daysInMonth(asOf);
  const elapsed = parse(asOf).day;
  const remaining = dim - elapsed;
  const expected = (target * elapsed) / dim;
  const progress = ratio(actualMtd, expected);
  const forecast = (actualMtd / elapsed) * dim;
  return {
    target,
    actual: actualMtd,
    expected,
    progress,
    status: statusFor(progress),
    attainment: actualMtd / target,
    runRateActual: actualMtd / elapsed,
    runRateNeeded: remaining === 0 ? 0 : Math.max(0, target - actualMtd) / remaining,
    forecast,
  };
}

/**
 * Target scorecard for the as-of month. Channels without a target get null;
 * the all-channel row compares the sum of targets with the GMV of the
 * channels that HAVE a target, so a missing target never inflates progress.
 */
export function targetScorecard(
  facts: DailyFact[],
  targets: { channel: string; targetGmv: number }[],
  channels: string[],
  asOf: string,
) {
  const mtd = facts.filter((f) => inRange(f.date, monthStart(asOf), asOf));
  const gmvOf = (ch: string) => mtd.filter((f) => f.channel === ch).reduce((s, f) => s + f.gmv, 0);
  const targetOf = new Map(targets.map((t) => [t.channel, t.targetGmv]));
  const rows = channels.map((channel) => {
    const t = targetOf.get(channel);
    return { channel, result: t ? targetProgress(t, gmvOf(channel), asOf) : null };
  });
  const withTarget = channels.filter((c) => targetOf.has(c));
  const all = withTarget.length
    ? targetProgress(
        withTarget.reduce((s, c) => s + targetOf.get(c)!, 0),
        withTarget.reduce((s, c) => s + gmvOf(c), 0),
        asOf,
      )
    : null;
  return { rows, all, channelsWithoutTarget: channels.filter((c) => !targetOf.has(c)) };
}

/** Channels whose data does not cover every day from the 1st to the as-of date. */
export function incompleteChannels(facts: DailyFact[], channels: string[], asOf: string) {
  const from = monthStart(asOf);
  const expectedDays = parse(asOf).day;
  return channels
    .map((channel) => ({
      channel,
      days: new Set(facts.filter((f) => f.channel === channel && inRange(f.date, from, asOf)).map((f) => f.date)).size,
    }))
    .filter((c) => c.days < expectedDays)
    .map((c) => ({ ...c, missingDays: expectedDays - c.days }));
}
