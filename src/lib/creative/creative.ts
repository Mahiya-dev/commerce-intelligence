/**
 * Phase 4 — Kreatif Meta (pure, no I/O).
 *
 * Ad naming convention (default): PRODUK_HOOK_ANGLE_FORMAT_BATCH_VERSI
 *   e.g. HUTAN500_TESTIMONI_KESEHATAN_VIF_B03_V2
 *   FORMAT: MI = Motion Image, VIF = Video in Frame, VID = Video, IMG = Image, CAR = Carousel
 *   BATCH:  B + number (B03)    VERSI: V + number (V2)
 * Parsing is best effort: a name that does not follow the convention is
 * reported as partial/failed and can be corrected by a user.
 */

export const CREATIVE_FORMATS = ["motion_image", "video_in_frame", "video", "image", "carousel", "lainnya"] as const;
export type CreativeFormat = (typeof CREATIVE_FORMATS)[number];

export const FORMAT_LABELS: Record<CreativeFormat, string> = {
  motion_image: "Motion Image",
  video_in_frame: "Video in Frame",
  video: "Video",
  image: "Gambar",
  carousel: "Carousel",
  lainnya: "Lainnya",
};

const FORMAT_CODES: Record<string, CreativeFormat> = {
  MI: "motion_image",
  VIF: "video_in_frame",
  VID: "video",
  IMG: "image",
  CAR: "carousel",
};

export type ParsedName = {
  product: string | null;
  hook: string | null;
  angle: string | null;
  format: CreativeFormat | null;
  batch: string | null;
  version: string | null;
  status: "ok" | "partial" | "failed";
};

const clean = (s: string | undefined) => {
  const v = (s ?? "").trim().toUpperCase();
  return v && /^[A-Z0-9-]{1,64}$/.test(v) ? v : null;
};

export function parseAdName(name: string): ParsedName {
  const parts = name
    .trim()
    .split(/\s*_\s*/)
    .filter(Boolean);
  if (parts.length < 3) {
    return { product: null, hook: null, angle: null, format: null, batch: null, version: null, status: "failed" };
  }
  // Locate format/batch/version by shape so a missing part doesn't shift the rest.
  const upper = parts.map((p) => p.toUpperCase());
  const fmtIdx = upper.findIndex((p) => p in FORMAT_CODES);
  const batch = upper.find((p) => /^B\d{1,4}$/.test(p)) ?? null;
  const version = upper.find((p) => /^V\d{1,4}$/.test(p)) ?? null;
  const head = fmtIdx >= 0 ? parts.slice(0, fmtIdx) : parts.filter((p) => !/^[BV]\d{1,4}$/i.test(p));
  const result: ParsedName = {
    product: clean(head[0]),
    hook: clean(head[1]),
    angle: clean(head[2]),
    format: fmtIdx >= 0 ? FORMAT_CODES[upper[fmtIdx]] : null,
    batch,
    version,
    status: "ok",
  };
  const fields = [result.product, result.hook, result.angle, result.format, result.batch, result.version];
  const filled = fields.filter((f) => f !== null).length;
  result.status = filled === fields.length && parts.length === 6 ? "ok" : filled >= 3 ? "partial" : "failed";
  return result;
}

// ---- metrics ---------------------------------------------------------------------

export type AdDailyFact = {
  adId: string;
  date: string;
  spend: number;
  impressions: number;
  reach: number | null;
  clicks: number;
  purchases: number;
  revenue: number;
};

export type AdMetrics = {
  spend: number;
  impressions: number;
  reach: number | null;
  clicks: number;
  purchases: number;
  revenue: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpa: number | null;
  roas: number | null;
  /** impressions ÷ reach (daily reach summed: an upper bound of true frequency). */
  frequency: number | null;
  days: number;
};

const div = (a: number, b: number) => (b === 0 ? null : a / b);

export function adMetrics(facts: AdDailyFact[]): AdMetrics {
  const t = facts.reduce(
    (s, f) => ({
      spend: s.spend + f.spend,
      impressions: s.impressions + f.impressions,
      clicks: s.clicks + f.clicks,
      purchases: s.purchases + f.purchases,
      revenue: s.revenue + f.revenue,
    }),
    { spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0 },
  );
  const reach = facts.some((f) => f.reach !== null) ? facts.reduce((s, f) => s + (f.reach ?? 0), 0) : null;
  return {
    ...t,
    reach,
    ctr: div(t.clicks, t.impressions),
    cpc: div(t.spend, t.clicks),
    cpm: t.impressions ? (t.spend / t.impressions) * 1000 : null,
    cpa: div(t.spend, t.purchases),
    roas: div(t.revenue, t.spend),
    frequency: reach ? t.impressions / reach : null,
    days: new Set(facts.map((f) => f.date)).size,
  };
}

// ---- winners & fatigue ------------------------------------------------------------

/** An ad needs this much evidence before it can be called a winner. */
export const WINNER_MIN_SPEND = 500_000;
export const WINNER_MIN_PURCHASES = 5;
/** Winner ROAS must beat the account ROAS of the period by this factor. */
export const WINNER_ROAS_LIFT = 1.2;

export function isWinner(m: AdMetrics, accountRoas: number | null): boolean {
  if (m.spend < WINNER_MIN_SPEND || m.purchases < WINNER_MIN_PURCHASES || m.roas === null) return false;
  return accountRoas === null ? true : m.roas >= accountRoas * WINNER_ROAS_LIFT;
}

/**
 * Creative fatigue: compares the ad's first 7 active days with its last 7
 * (within its whole history up to the as-of date). Needs ≥ 14 active days.
 *   Lelah   (fatigued): CTR −30% or worse, AND (frequency ≥ 3 or CPA +30% or worse)
 *   Waspada (watch):    CTR −15% or worse
 *   Sehat:              otherwise
 */
export const FATIGUE_WINDOW = 7;
export const FATIGUE_CTR_DROP = 0.3;
export const WATCH_CTR_DROP = 0.15;
export const FATIGUE_FREQUENCY = 3;
export const FATIGUE_CPA_RISE = 0.3;

export type FatigueStatus = "lelah" | "waspada" | "sehat" | "belum_cukup";
export const FATIGUE_LABELS: Record<FatigueStatus, string> = {
  lelah: "Lelah",
  waspada: "Waspada",
  sehat: "Sehat",
  belum_cukup: "Data belum cukup",
};

export type Fatigue = {
  status: FatigueStatus;
  ctrChange: number | null;
  cpaChange: number | null;
  recentFrequency: number | null;
  activeDays: number;
};

export function fatigue(facts: AdDailyFact[]): Fatigue {
  const active = [...facts].filter((f) => f.impressions > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (active.length < FATIGUE_WINDOW * 2) {
    return {
      status: "belum_cukup",
      ctrChange: null,
      cpaChange: null,
      recentFrequency: null,
      activeDays: active.length,
    };
  }
  const early = adMetrics(active.slice(0, FATIGUE_WINDOW));
  const recent = adMetrics(active.slice(-FATIGUE_WINDOW));
  const change = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b - 1);
  const ctrChange = change(recent.ctr, early.ctr);
  const cpaChange = change(recent.cpa, early.cpa);
  // Average daily frequency over the recent window (daily reach is not additive across days).
  const freqDays = active.slice(-FATIGUE_WINDOW).filter((f) => f.reach);
  const recentFrequency = freqDays.length
    ? freqDays.reduce((s, f) => s + f.impressions / f.reach!, 0) / freqDays.length
    : null;
  let status: FatigueStatus = "sehat";
  if (ctrChange !== null && ctrChange <= -FATIGUE_CTR_DROP) {
    const pressure =
      (recentFrequency !== null && recentFrequency >= FATIGUE_FREQUENCY) ||
      (cpaChange !== null && cpaChange >= FATIGUE_CPA_RISE);
    status = pressure ? "lelah" : "waspada";
  } else if (ctrChange !== null && ctrChange <= -WATCH_CTR_DROP) {
    status = "waspada";
  }
  return { status, ctrChange, cpaChange, recentFrequency, activeDays: active.length };
}

// ---- grouping ------------------------------------------------------------------

export type Classified = { adId: string; format: CreativeFormat | null; hook: string | null; angle: string | null };

/** Metrics per value of a classification field (null → "Tidak terklasifikasi"). */
export function groupBy(
  facts: AdDailyFact[],
  classes: Map<string, Classified>,
  field: "format" | "hook" | "angle",
): { key: string | null; ads: number; metrics: AdMetrics }[] {
  const groups = new Map<string | null, { ads: Set<string>; facts: AdDailyFact[] }>();
  for (const f of facts) {
    const key = classes.get(f.adId)?.[field] ?? null;
    const g = groups.get(key) ?? { ads: new Set(), facts: [] };
    g.ads.add(f.adId);
    g.facts.push(f);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, ads: g.ads.size, metrics: adMetrics(g.facts) }))
    .sort((a, b) => b.metrics.spend - a.metrics.spend);
}
