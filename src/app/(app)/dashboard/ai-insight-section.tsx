import { AlertTriangle, CheckCircle2, Info, Sparkles } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/format";
import type { DashboardInsightView } from "@/lib/ai/insights";
import type { InsightItem } from "@/lib/ai/insight-model";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { generateInsight } from "./actions";
import { InsightSubmitButton } from "./insight-button";

const OUTCOME: Record<string, { tone: "ok" | "info" | "bad"; text: string }> = {
  created: { tone: "ok", text: "Insight baru dibuat dari data terbaru." },
  unchanged: { tone: "info", text: "Data belum berubah sejak insight terakhir, jadi insight yang ada tetap dipakai." },
  no_data: { tone: "bad", text: "Belum ada data penjualan yang disimpan untuk dianalisis." },
  not_configured: { tone: "bad", text: "AI belum dikonfigurasi di server (GROQ_API_KEY)." },
  rate_limited: { tone: "bad", text: "Batas pembuatan insight tercapai. Coba lagi nanti." },
  invalid_response: {
    tone: "bad",
    text: "Jawaban AI tidak memenuhi syarat (tanpa bukti dari data, atau menulis angka sendiri) dan tidak disimpan. Coba lagi.",
  },
  provider_auth: { tone: "bad", text: "API key Groq ditolak. Periksa GROQ_API_KEY di server." },
  provider_rate_limited: { tone: "bad", text: "Kuota Groq sedang habis. Coba lagi beberapa saat lagi." },
  provider_timeout: { tone: "bad", text: "Groq terlalu lama menjawab. Coba lagi." },
  provider_unavailable: { tone: "bad", text: "Layanan Groq tidak dapat dihubungi. Coba lagi nanti." },
  provider_bad_request: {
    tone: "bad",
    text: "Groq menolak permintaan. Pastikan GROQ_MODEL mendukung structured outputs (json_schema).",
  },
  provider_bad_response: { tone: "bad", text: "Jawaban Groq tidak dapat dibaca. Coba lagi." },
  error: { tone: "bad", text: "Insight gagal dibuat karena gangguan layanan. Coba lagi." },
};

const PRIORITY: Record<InsightItem["priority"], { label: string; variant: "default" | "secondary" | "outline" }> = {
  tinggi: { label: "Prioritas tinggi", variant: "default" },
  sedang: { label: "Prioritas sedang", variant: "secondary" },
  rendah: { label: "Prioritas rendah", variant: "outline" },
};

function GenerateForm({ label }: { label: string }) {
  return (
    <form action={generateInsight}>
      <InsightSubmitButton label={label} />
    </form>
  );
}

export function AiInsightSection({
  view,
  outcome,
  timeZone,
}: {
  view: DashboardInsightView;
  outcome?: string;
  timeZone: string;
}) {
  const { insight, configured, canGenerate, hasData, stale } = view;
  const message = outcome ? OUTCOME[outcome] : undefined;
  const showButton = canGenerate && configured && hasData && (!insight || stale);

  return (
    <section aria-labelledby="insight-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="insight-heading" className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden /> Insight AI
        </h2>
        {insight ? (
          <p className="text-xs text-muted-foreground">
            Dibuat AI ({insight.model}) · {formatDateTime(insight.createdAt, timeZone)} · data s.d.{" "}
            {formatDate(insight.asOf, "UTC")}
          </p>
        ) : null}
      </div>

      {message ? (
        <Alert variant={message.tone === "bad" ? "destructive" : "default"}>
          {message.tone === "bad" ? <AlertTriangle aria-hidden /> : <CheckCircle2 aria-hidden />}
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}

      {insight ? (
        <Card className="gap-4 py-5">
          <CardContent className="space-y-4 px-5">
            {stale ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                <span>Data sudah berubah sejak insight ini dibuat.</span>
                {canGenerate && configured ? <GenerateForm label="Perbarui insight" /> : null}
              </div>
            ) : null}
            {insight.output.headline ? (
              <p className="text-base leading-snug font-medium">{insight.output.headline}</p>
            ) : null}
            <ul className="grid gap-3 lg:grid-cols-2">
              {insight.output.insights.map((it, i) => (
                <li key={i} className="space-y-2.5 rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={PRIORITY[it.priority].variant}>{PRIORITY[it.priority].label}</Badge>
                    <span className="text-xs text-muted-foreground">{it.scopeLabel}</span>
                  </div>
                  <h3 className="leading-snug font-medium">{it.title}</h3>
                  <p className="text-sm text-muted-foreground">{it.finding}</p>
                  <dl className="space-y-1 rounded-md bg-muted/50 px-3 py-2 text-xs">
                    {it.evidence.map((e) => (
                      <div key={e.metric + e.scope} className="flex flex-wrap justify-between gap-x-3">
                        <dt className="text-muted-foreground">{e.label}</dt>
                        <dd className="font-medium tabular-nums">{e.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-sm">
                    <span className="font-medium">Langkah: </span>
                    {it.action}
                  </p>
                </li>
              ))}
            </ul>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                Teks dibuat oleh AI dan bisa keliru; penyebab yang disebut adalah dugaan. Semua angka di kotak bukti
                diambil langsung dari data aplikasi, bukan ditulis AI.
                {insight.output.limitations ? ` Keterbatasan: ${insight.output.limitations}` : ""}
              </span>
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 px-5">
            <p className="max-w-xl text-sm text-muted-foreground">
              {!hasData
                ? "Insight tersedia setelah ada data penjualan yang disimpan."
                : !configured
                  ? canGenerate
                    ? "AI belum dikonfigurasi. Isi GROQ_API_KEY di .env server untuk mengaktifkan insight."
                    : "Insight AI belum diaktifkan untuk organisasi ini."
                  : canGenerate
                    ? "Belum ada insight. AI akan membaca KPI di atas dan merangkum temuan serta langkah yang disarankan."
                    : "Belum ada insight. Analyst atau admin dapat membuatnya."}
            </p>
            {showButton ? <GenerateForm label="Buat insight" /> : null}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
