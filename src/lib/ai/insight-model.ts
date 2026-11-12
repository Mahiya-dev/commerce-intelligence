import { createHash } from "node:crypto";
import { z } from "zod";
import type { EcommerceOverview } from "@/lib/data/ecommerce";
import type { JsonSchema } from "@/lib/ai/types";
import { daysInMonth } from "@/lib/ecommerce/kpi";

/**
 * Pure part of the dashboard insight (no I/O): what the model receives, the
 * response schema, validation and evidence rendering.
 *
 * GROUNDING RULE: the model never writes figures. Each insight cites
 * evidence as {metric, scope} references; the APP renders their values from
 * the input. Insights whose text contains digits, or without one valid
 * evidence reference, are dropped. So every number shown next to an AI
 * insight comes from the database, not from the model.
 */

export const METRICS = [
  "gmv_mtd",
  "gmv_mom",
  "orders_mtd",
  "orders_mom",
  "aov",
  "aov_mom",
  "conversion_rate",
  "target_progress",
  "run_rate_needed",
  "forecast",
  "missing_days",
  "avg_daily_gmv_trend",
  "sku_share",
  "unmapped_share",
] as const;
export type Metric = (typeof METRICS)[number];

export const METRIC_LABELS: Record<Metric, string> = {
  gmv_mtd: "GMV bulan berjalan",
  gmv_mom: "GMV vs periode setara bulan lalu",
  orders_mtd: "Pesanan bulan berjalan",
  orders_mom: "Pesanan vs periode setara bulan lalu",
  aov: "AOV",
  aov_mom: "AOV vs periode setara bulan lalu",
  conversion_rate: "Conversion rate",
  target_progress: "Progres target",
  run_rate_needed: "GMV dibutuhkan per hari",
  forecast: "Forecast akhir bulan",
  missing_days: "Hari tanpa data",
  avg_daily_gmv_trend: "GMV rata-rata per hari per bulan",
  sku_share: "Porsi GMV SKU",
  unmapped_share: "Porsi GMV belum dipetakan",
};

const CHANNEL_METRICS: Metric[] = [
  "gmv_mtd",
  "gmv_mom",
  "orders_mtd",
  "orders_mom",
  "aov",
  "aov_mom",
  "conversion_rate",
  "target_progress",
  "run_rate_needed",
  "forecast",
  "missing_days",
  "avg_daily_gmv_trend",
];

type Num = number | null;

export type ChannelMetrics = {
  code: string;
  name: string;
  gmv_mtd: number;
  gmv_mom: Num;
  orders_mtd: number;
  orders_mom: Num;
  aov: Num;
  aov_mom: Num;
  conversion_rate: Num;
  target: Num;
  target_progress: Num;
  target_status: string | null;
  run_rate_needed: Num;
  forecast: Num;
  missing_days: number;
  /** Average GMV per day with data, oldest month first. */
  avg_daily_gmv_trend: { month: string; value: Num }[];
};

export type InsightInput = {
  as_of: string;
  month: string;
  days_elapsed: number;
  days_in_month: number;
  channels: ChannelMetrics[];
  all: ChannelMetrics;
  skus: { sku: string; name: string; share: number }[];
  unmapped_share: Num;
};

const r = (v: number | null, digits = 4): Num => (v === null || !Number.isFinite(v) ? null : Number(v.toFixed(digits)));
const STATUS: Record<string, string> = { on_track: "On Track", watch: "Watch", at_risk: "At Risk" };

/** Compact, deterministic metrics for the model (also stored as evidence). */
export function buildInsightInput(o: Extract<EcommerceOverview, { status: "ok" }>, maxSkus = 8): InsightInput {
  const nameOf = new Map(o.channels.map((c) => [c.code, c.name]));
  const missing = new Map(o.incomplete.map((c) => [c.channel, c.missingDays]));
  const trend = (code: string | null) =>
    o.months.map((m) => {
      const t = code ? m.rows.find((x) => x.channel === code)?.totals : m.all;
      return {
        month: m.month,
        value: t && t.days ? Math.round(t.gmv / (code ? t.days : t.days / o.channels.length)) : null,
      };
    });
  const metricsFor = (code: string | null): ChannelMetrics => {
    const mom = code ? o.mom.rows.find((x) => x.channel === code)! : o.mom.all;
    const tgt = code ? (o.targets.rows.find((x) => x.channel === code)?.result ?? null) : o.targets.all;
    return {
      code: code ?? "all",
      name: code ? (nameOf.get(code) ?? code) : "Semua channel",
      gmv_mtd: mom.current.gmv,
      gmv_mom: r(mom.gmvChange),
      orders_mtd: mom.current.orders,
      orders_mom: r(mom.ordersChange),
      aov: r(mom.current.aov, 0),
      aov_mom: r(mom.aovChange),
      conversion_rate: r(mom.current.conversionRate),
      target: tgt?.target ?? null,
      target_progress: tgt ? r(tgt.progress) : null,
      target_status: tgt?.status ? STATUS[tgt.status] : null,
      run_rate_needed: tgt ? Math.round(tgt.runRateNeeded) : null,
      forecast: tgt ? Math.round(tgt.forecast) : null,
      missing_days: code ? (missing.get(code) ?? 0) : o.incomplete.reduce((s, c) => s + c.missingDays, 0),
      avg_daily_gmv_trend: trend(code),
    };
  };
  const total = o.skuCoverage.listingGmv;
  const unmapped = o.skus.find((s) => s.sku === null);
  return {
    as_of: o.asOf,
    month: o.month,
    days_elapsed: Number(o.asOf.slice(8, 10)),
    days_in_month: daysInMonth(o.asOf),
    channels: o.channels.map((c) => metricsFor(c.code)),
    all: metricsFor(null),
    skus: o.skus
      .filter((s) => s.sku !== null)
      .slice(0, maxSkus)
      .map((s) => ({ sku: s.sku!, name: s.name ?? s.sku!, share: r(total ? s.gmv / total : null) ?? 0 })),
    unmapped_share: total ? r((unmapped?.gmv ?? 0) / total) : null,
  };
}

/** One insight per data version: SHA-256 of the canonical input. */
export function fingerprint(input: InsightInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

// ---- response schema ----------------------------------------------------------

export const PRIORITIES = ["tinggi", "sedang", "rendah"] as const;

export function scopesFor(input: InsightInput): string[] {
  return ["all", ...input.channels.map((c) => c.code), ...input.skus.map((s) => s.sku)];
}

/** JSON Schema for strict structured output (every field required, no extras). */
export function responseJsonSchema(input: InsightInput): JsonSchema {
  const scope = { type: "string", enum: scopesFor(input) };
  return {
    type: "object",
    additionalProperties: false,
    required: ["headline", "insights", "limitations"],
    properties: {
      headline: { type: "string", description: "Satu kalimat ringkasan, tanpa angka." },
      insights: {
        type: "array",
        description: "2 sampai 4 insight, paling penting dulu.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "finding", "action", "priority", "scope", "evidence"],
          properties: {
            title: { type: "string", description: "Judul singkat, tanpa angka." },
            finding: { type: "string", description: "Temuan dan kemungkinan penyebab, tanpa angka." },
            action: { type: "string", description: "Langkah konkret berikutnya, tanpa angka." },
            priority: { type: "string", enum: [...PRIORITIES] },
            scope,
            evidence: {
              type: "array",
              description: "1 sampai 3 metrik yang mendukung temuan.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["metric", "scope"],
                properties: { metric: { type: "string", enum: [...METRICS] }, scope },
              },
            },
          },
        },
      },
      limitations: { type: "string", description: "Keterbatasan data yang perlu diketahui pembaca, tanpa angka." },
    },
  };
}

const text = (max: number) => z.string().trim().min(1).max(max);
const rawSchema = z.object({
  headline: z.string().trim().max(240),
  insights: z
    .array(
      z.object({
        title: text(140),
        finding: text(600),
        action: text(400),
        priority: z.enum(PRIORITIES),
        scope: z.string(),
        evidence: z.array(z.object({ metric: z.enum(METRICS), scope: z.string() })).max(5),
      }),
    )
    .max(8),
  limitations: z.string().trim().max(500),
});

export type EvidenceView = { metric: Metric; scope: string; label: string; value: string };
export type InsightItem = {
  title: string;
  finding: string;
  action: string;
  priority: (typeof PRIORITIES)[number];
  scope: string;
  scopeLabel: string;
  evidence: EvidenceView[];
};
export type InsightOutput = { headline: string | null; insights: InsightItem[]; limitations: string | null };

// ---- evidence rendering (values come from the input, never from the model) ----

const idr = (v: number) => `Rp${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(v / 1e6)} jt`;
const pctFmt = (v: number, digits = 1) =>
  new Intl.NumberFormat("id-ID", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${pctFmt(Math.abs(v))}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function channelValue(c: ChannelMetrics, metric: Metric): string | null {
  switch (metric) {
    case "gmv_mtd":
      return idr(c.gmv_mtd);
    case "orders_mtd":
      return new Intl.NumberFormat("id-ID").format(c.orders_mtd);
    case "gmv_mom":
    case "orders_mom":
    case "aov_mom":
      return c[metric] === null ? null : signed(c[metric]);
    case "aov":
      return c.aov === null ? null : `Rp${new Intl.NumberFormat("id-ID").format(c.aov)}`;
    case "conversion_rate":
      return c.conversion_rate === null ? null : pctFmt(c.conversion_rate, 2);
    case "target_progress":
      return c.target_progress === null ? null : `${pctFmt(c.target_progress)} (${c.target_status})`;
    case "run_rate_needed":
    case "forecast":
      return c[metric] === null ? null : idr(c[metric]);
    case "missing_days":
      return `${c.missing_days} hari`;
    case "avg_daily_gmv_trend": {
      const pts = c.avg_daily_gmv_trend.filter((p) => p.value !== null);
      return pts.length ? pts.map((p) => `${MONTHS[Number(p.month.slice(5)) - 1]} ${idr(p.value!)}`).join(" → ") : null;
    }
    default:
      return null;
  }
}

export function renderEvidence(input: InsightInput, metric: Metric, scope: string): EvidenceView | null {
  if (metric === "sku_share") {
    const s = input.skus.find((x) => x.sku === scope);
    return s ? { metric, scope, label: `${METRIC_LABELS[metric]} ${s.name}`, value: pctFmt(s.share) } : null;
  }
  if (metric === "unmapped_share") {
    return input.unmapped_share === null || scope !== "all"
      ? null
      : { metric, scope, label: METRIC_LABELS[metric], value: pctFmt(input.unmapped_share) };
  }
  if (!CHANNEL_METRICS.includes(metric)) return null;
  const c = scope === "all" ? input.all : input.channels.find((x) => x.code === scope);
  if (!c) return null;
  const value = channelValue(c, metric);
  return value === null ? null : { metric, scope, label: `${METRIC_LABELS[metric]} · ${c.name}`, value };
}

const HAS_DIGIT = /\d/;

export function scopeLabel(input: InsightInput, scope: string): string {
  if (scope === "all") return "Semua channel";
  return input.channels.find((c) => c.code === scope)?.name ?? input.skus.find((s) => s.sku === scope)?.name ?? scope;
}

/**
 * Validates the model's JSON and applies the grounding rule. Returns null when
 * the response is unusable (wrong shape or no grounded insight left).
 */
export function validateInsightOutput(input: InsightInput, json: unknown, maxInsights = 4): InsightOutput | null {
  const parsed = rawSchema.safeParse(json);
  if (!parsed.success) return null;
  const scopes = new Set(scopesFor(input));
  const insights: InsightItem[] = [];
  for (const it of parsed.data.insights) {
    if ([it.title, it.finding, it.action].some((t) => HAS_DIGIT.test(t))) continue;
    if (!scopes.has(it.scope)) continue;
    const seen = new Set<string>();
    const evidence = it.evidence
      .map((e) => renderEvidence(input, e.metric, e.scope))
      .filter((e): e is EvidenceView => e !== null)
      .filter((e) => (seen.has(e.metric + e.scope) ? false : (seen.add(e.metric + e.scope), true)))
      .slice(0, 3);
    if (evidence.length === 0) continue;
    insights.push({ ...it, scopeLabel: scopeLabel(input, it.scope), evidence });
    if (insights.length === maxInsights) break;
  }
  if (insights.length === 0) return null;
  const headline = parsed.data.headline && !HAS_DIGIT.test(parsed.data.headline) ? parsed.data.headline : null;
  const limitations =
    parsed.data.limitations && !HAS_DIGIT.test(parsed.data.limitations) ? parsed.data.limitations : null;
  return { headline, insights, limitations };
}

// ---- prompt ------------------------------------------------------------------

export const SYSTEM_PROMPT = `Anda analis e-commerce untuk Madu Uray (produk madu) yang berjualan di Shopee, TikTok Shop dan Tokopedia.
Tugas: dari metrik JSON yang diberikan, tulis 2 sampai 4 insight paling penting untuk pengambil keputusan, dalam Bahasa Indonesia yang ringkas.

Aturan wajib:
- Gunakan HANYA data yang diberikan. Jangan mengarang fakta, penyebab pasti, kompetitor, promo, atau data yang tidak ada.
- JANGAN menulis angka apa pun (termasuk persen, rupiah, tanggal) di headline, title, finding, action, maupun limitations. Angka ditampilkan otomatis dari "evidence".
- Setiap insight wajib punya 1 sampai 3 evidence berupa pasangan metric + scope yang benar-benar ada di data.
- Sebut kemungkinan penyebab sebagai dugaan ("kemungkinan", "perlu dicek"), bukan kepastian.
- action harus konkret dan bisa dikerjakan tim minggu ini.
- Prioritaskan: channel yang tertinggal dari target, penurunan dibanding periode setara bulan lalu, data yang belum lengkap, dan GMV yang belum dipetakan ke SKU.
- Bila ada hari tanpa data (missing_days), sebutkan di limitations bahwa angka channel itu bisa terlihat lebih rendah.
- target_progress = GMV bulan berjalan dibanding target yang seharusnya sudah tercapai hingga as_of (bukan dibanding target penuh).`;

export function userPrompt(input: InsightInput): string {
  return `Metrik e-commerce (data s.d. ${input.as_of}, nilai rupiah dalam IDR, rasio dalam desimal):\n${JSON.stringify(input)}`;
}
