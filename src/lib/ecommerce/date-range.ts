import { addMonths, daysInMonth, monthEnd, monthStart } from "@/lib/ecommerce/kpi";

/**
 * Dashboard date range (pure, no I/O). Presets are anchored on the as-of
 * date (latest shop data ≤ today, docs/architecture.md §8 #10), so a preset
 * never shows an empty tail while today's reports are not uploaded yet.
 *
 * Comparison period:
 * - mtd         → days 1..N of last month (equivalent-period MoM)
 * - last_month  → the full month before it
 * - otherwise   → the same number of days immediately before the range
 */
export const RANGE_PRESETS = ["mtd", "7d", "30d", "90d", "last_month", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  mtd: "Bulan ini (MTD)",
  "7d": "7 hari terakhir",
  "30d": "30 hari terakhir",
  "90d": "90 hari terakhir",
  last_month: "Bulan lalu",
  custom: "Kustom",
};

/** Longest custom range (keeps the fact query bounded). */
export const MAX_RANGE_DAYS = 366;

export type Period = { from: string; to: string };

export type ResolvedRange = Period & {
  preset: RangePreset;
  days: number;
  compare: Period;
  /** Set when the requested range was invalid and the default was used. */
  error?: string;
  /** Set when a custom range ended after the latest data and was cut to this date. */
  clippedTo?: string;
};

export type RangeInput = { range?: string; from?: string; to?: string };

const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(v: string | undefined): v is string {
  const m = v ? ISO_RE.exec(v) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive number of calendar days in a period. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

function precedingPeriod(p: Period): Period {
  const len = daysBetween(p.from, p.to);
  return { from: addDays(p.from, -len), to: addDays(p.from, -1) };
}

function equivalentLastMonth(asOf: string): Period {
  const from = addMonths(asOf, -1);
  const day = Math.min(Number(asOf.slice(8, 10)), daysInMonth(from));
  return { from, to: `${from.slice(0, 8)}${String(day).padStart(2, "0")}` };
}

function build(preset: RangePreset, period: Period, compare: Period, error?: string): ResolvedRange {
  return { preset, ...period, days: daysBetween(period.from, period.to), compare, ...(error ? { error } : {}) };
}

function presetRange(preset: Exclude<RangePreset, "custom">, asOf: string): ResolvedRange {
  switch (preset) {
    case "mtd":
      return build(preset, { from: monthStart(asOf), to: asOf }, equivalentLastMonth(asOf));
    case "last_month": {
      const from = addMonths(asOf, -1);
      const prev = addMonths(asOf, -2);
      return build(preset, { from, to: monthEnd(from) }, { from: prev, to: monthEnd(prev) });
    }
    default: {
      const len = Number(preset.replace("d", ""));
      const period = { from: addDays(asOf, -(len - 1)), to: asOf };
      return build(preset, period, precedingPeriod(period));
    }
  }
}

export function resolveRange(input: RangeInput, asOf: string): ResolvedRange {
  const preset = (RANGE_PRESETS as readonly string[]).includes(input.range ?? "")
    ? (input.range as RangePreset)
    : // Dates without a preset (e.g. a shared link) mean a custom range.
      isIsoDate(input.from) && isIsoDate(input.to)
      ? "custom"
      : "mtd";
  if (preset !== "custom") return presetRange(preset, asOf);

  const fail = (error: string) => ({ ...presetRange("mtd", asOf), error });
  if (!isIsoDate(input.from) || !isIsoDate(input.to)) return fail("Tanggal tidak valid; menampilkan bulan ini.");
  if (input.from > input.to) return fail("Tanggal awal setelah tanggal akhir; menampilkan bulan ini.");
  if (daysBetween(input.from, input.to) > MAX_RANGE_DAYS) {
    return fail(`Rentang maksimal ${MAX_RANGE_DAYS} hari; menampilkan bulan ini.`);
  }
  if (input.from > asOf) return fail(`Belum ada data setelah ${asOf}; menampilkan bulan ini.`);
  // Clip to the as-of date so the comparison has the same number of days with data.
  const period = { from: input.from, to: input.to > asOf ? asOf : input.to };
  return { ...build("custom", period, precedingPeriod(period)), ...(input.to > asOf ? { clippedTo: asOf } : {}) };
}
