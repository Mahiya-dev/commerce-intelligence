/** Shared helpers for the hand-drawn SVG/HTML charts (no chart library). */

/** Fixed channel colors: color follows the channel, never its rank. */
const CHANNEL_COLOR: Record<string, string> = {
  shopee: "var(--chart-shopee)",
  tiktok_shop: "var(--chart-tiktok-shop)",
  tokopedia: "var(--chart-tokopedia)",
};

export function channelColor(code: string): string {
  return CHANNEL_COLOR[code] ?? "var(--chart-other)";
}

/** Clean axis ticks from 0 to at least `max` (1/2/2.5/5 × 10^n steps). */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

const SHORT_DATE = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("id-ID", { month: "short", year: "numeric", timeZone: "UTC" });

/** "1 Nov" from YYYY-MM-DD. */
export const shortDate = (d: string) => SHORT_DATE.format(new Date(`${d}T00:00:00Z`));
/** "Nov 2026" from YYYY-MM or YYYY-MM-DD. */
export const monthLabel = (m: string) => MONTH.format(new Date(`${m.slice(0, 7)}-01T00:00:00Z`));
