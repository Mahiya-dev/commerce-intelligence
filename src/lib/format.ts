/**
 * Locale-aware formatting for Bahasa Indonesia UI.
 * All formatters render missing values explicitly as "—" (never as 0), so
 * absent data is never mistaken for zero sales.
 */
const LOCALE = "id-ID";
export const MISSING = "—";

type Num = number | null | undefined;

function isNum(v: Num): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function formatIDR(value: Num, opts: { compact?: boolean } = {}): string {
  if (!isNum(value)) return MISSING;
  if (opts.compact) {
    const abs = Math.abs(value);
    const sign = value < 0 ? "-" : "";
    const fmt = (n: number, unit: string) =>
      `${sign}Rp${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(n)} ${unit}`;
    if (abs >= 1e12) return fmt(abs / 1e12, "T");
    if (abs >= 1e9) return fmt(abs / 1e9, "M");
    if (abs >= 1e6) return fmt(abs / 1e6, "jt");
    if (abs >= 1e3) return fmt(abs / 1e3, "rb");
  }
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: Num, maximumFractionDigits = 0): string {
  if (!isNum(value)) return MISSING;
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits }).format(value);
}

/** `ratio` is a fraction (0.153 → "15,3%"). */
export function formatPercent(ratio: Num, maximumFractionDigits = 1): string {
  if (!isNum(ratio)) return MISSING;
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(ratio);
}

export function formatDate(value: string | Date | null | undefined, timeZone = "Asia/Jakarta"): string {
  if (!value) return MISSING;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return MISSING;
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeZone }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined, timeZone = "Asia/Jakarta"): string {
  if (!value) return MISSING;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return MISSING;
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short", timeZone }).format(d);
}
