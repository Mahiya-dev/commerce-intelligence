"use client";

import { useActionState, useState, type ComponentType } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Info, Loader2, PlugZap, Sheet } from "lucide-react";
import { cn } from "@/lib/utils";
import { INITIAL_IMPORT_STATE } from "@/lib/imports/form-state";
import { MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES } from "@/lib/imports/limits";
import { TEMPLATE_LIST, TEMPLATES, type TemplateKey } from "@/lib/imports/templates";
import { submitImport } from "./actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ImportMethod = "file" | "google_sheets" | "api";
export type ApiPlatform = "tiktok_shop" | "tokopedia" | "shopee";
type ReportTypeChoice = "auto" | TemplateKey;

const mb = (bytes: number) =>
  `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: bytes >= 1024 * 1024 ? 1 : 0 }).format(
    bytes >= 1024 * 1024 ? bytes / 1024 / 1024 : Math.max(1, Math.round(bytes / 1024)),
  )} ${bytes >= 1024 * 1024 ? "MB" : "KB"}`;

const REPORT_PURPOSE: Record<TemplateKey, string> = {
  kinerja_toko_harian: "GMV, pesanan, unit dan pengunjung per channel per hari.",
  kinerja_produk_harian: "Kinerja per listing/SKU marketplace per hari.",
  target_bulanan: "Target GMV (dan pesanan) per channel per bulan.",
  master_listing: "Pemetaan listing marketplace ke SKU internal.",
  kinerja_touchpoint:
    "GMV, pesanan dan biaya per listing per touchpoint (organik, iklan, afiliasi, live, video) per hari.",
  meta_ads_harian: "Spend, impresi, klik, pembelian dan nilai pembelian per iklan Meta (Ad ID asli) per hari.",
  penjualan_hsl: "Unit terjual, GMV dan komisi per afiliasi Shopee HSL per listing per hari.",
  iklan_marketplace_harian:
    "Biaya, omzet, klik dan konversi per kampanye iklan marketplace (mis. Shopee Ads) per hari.",
};

const METHODS: {
  value: ImportMethod;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  {
    value: "file",
    title: "Unggah Excel / CSV",
    description: "File template standar (.xlsx atau .csv).",
    icon: FileSpreadsheet,
  },
  {
    value: "google_sheets",
    title: "Google Spreadsheet",
    description: "Tarik satu tab dari spreadsheet yang dibagikan.",
    icon: Sheet,
  },
  {
    value: "api",
    title: "Koneksi API",
    description: "Sinkronisasi langsung dari TikTok Shop, Tokopedia atau Shopee.",
    icon: PlugZap,
  },
];

const API_PLATFORMS: { value: ApiPlatform; label: string }[] = [
  { value: "tiktok_shop", label: "TikTok Shop" },
  { value: "tokopedia", label: "Tokopedia" },
  { value: "shopee", label: "Shopee" },
];

const SUBMIT_LABEL: Record<ImportMethod, string> = {
  file: "Unggah & validasi",
  google_sheets: "Tarik & validasi",
  api: "Hubungkan toko",
};

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  return errors?.length ? (
    <p id={id} className="text-xs text-destructive">
      {errors[0]}
    </p>
  ) : null;
}

/**
 * Import source selector. Exactly one method is active at a time; only the
 * fields of the selected method are rendered (and thus submitted).
 */
export function ImportSourcePicker({ apiConfigured = false }: { apiConfigured?: boolean }) {
  const [method, setMethod] = useState<ImportMethod>("file");
  const [platform, setPlatform] = useState<ApiPlatform>("tiktok_shop");
  const [reportType, setReportType] = useState<ReportTypeChoice>("auto");
  const [selected, setSelected] = useState<{ name: string; size: number }[]>([]);
  const totalSize = selected.reduce((s, f) => s + f.size, 0);
  const [state, action, pending] = useActionState(submitImport, INITIAL_IMPORT_STATE);
  const apiBlocked = method === "api" && !apiConfigured;
  const fileErrors = state.fieldErrors?.file;
  const sheetErrors = state.fieldErrors?.sheetUrl;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Sumber data</CardTitle>
        <CardDescription>Pilih salah satu metode impor.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-6" noValidate>
          <fieldset className="grid gap-3 sm:grid-cols-3" disabled={pending}>
            <legend className="sr-only">Metode impor</legend>
            {METHODS.map((m) => {
              const selected = method === m.value;
              const Icon = m.icon;
              return (
                <label
                  key={m.value}
                  className={cn(
                    "flex cursor-pointer flex-col gap-2 rounded-lg border p-4 text-sm transition-colors",
                    "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                    selected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <Icon className="size-5 text-muted-foreground" aria-hidden />
                    <input
                      type="radio"
                      name="method"
                      value={m.value}
                      checked={selected}
                      onChange={() => setMethod(m.value)}
                      className="size-4 accent-primary"
                    />
                  </span>
                  <span className="font-medium">{m.title}</span>
                  <span className="text-xs text-muted-foreground">{m.description}</span>
                </label>
              );
            })}
          </fieldset>

          {method === "file" ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="report-type">Jenis data</Label>
                <select
                  id="report-type"
                  name="reportType"
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value as ReportTypeChoice)}
                  disabled={pending}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive sm:max-w-sm dark:bg-input/30"
                  aria-invalid={state.fieldErrors?.reportType?.length ? true : undefined}
                  aria-describedby="report-type-hint"
                >
                  <option value="auto">Deteksi otomatis</option>
                  {TEMPLATE_LIST.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.title}
                    </option>
                  ))}
                </select>
                <FieldError id="report-type-error" errors={state.fieldErrors?.reportType} />
                <p id="report-type-hint" className="text-xs text-muted-foreground">
                  {reportType === "auto" ? (
                    <>
                      Jenis dikenali dari baris header. Workbook .xlsx boleh berisi beberapa sheet bernama sesuai jenis
                      data (mis. <code>kinerja_toko_harian</code>); setiap sheet menjadi satu batch. Ekspor{" "}
                      <strong>Performa Produk Shopee</strong> (<code>parentskudetail.…xlsx</code>, per hari) juga
                      dikenali langsung; jangan ganti nama filenya.
                    </>
                  ) : (
                    <>
                      {REPORT_PURPOSE[reportType]} Kolom wajib:{" "}
                      {TEMPLATES[reportType].columns
                        .filter((c) => c.required)
                        .map((c) => c.name)
                        .join(", ")}
                      . Untuk .xlsx, hanya sheet <code>{reportType}</code> yang diambil (atau sheet pertama bila tidak
                      ada).
                    </>
                  )}
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="import-file">File laporan (boleh lebih dari satu)</Label>
                <Input
                  id="import-file"
                  name="file"
                  type="file"
                  multiple
                  required
                  onChange={(e) =>
                    setSelected(Array.from(e.currentTarget.files ?? []).map((f) => ({ name: f.name, size: f.size })))
                  }
                  disabled={pending}
                  accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  aria-invalid={fileErrors?.length ? true : undefined}
                  aria-describedby={fileErrors?.length ? "import-file-error" : undefined}
                />
                <FieldError id="import-file-error" errors={fileErrors} />
                {selected.length ? (
                  <ul className="grid gap-1 rounded-md border p-2 text-xs" aria-label="File yang dipilih">
                    {selected.map((f) => (
                      <li key={f.name} className="flex justify-between gap-3">
                        <span className="truncate">{f.name}</span>
                        <span className={f.size > MAX_FILE_BYTES ? "text-destructive" : "text-muted-foreground"}>
                          {mb(f.size)}
                        </span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-3 border-t pt-1 font-medium">
                      <span>
                        {selected.length} file{selected.length > MAX_FILES ? ` (maks. ${MAX_FILES})` : ""}
                      </span>
                      <span className={totalSize > MAX_TOTAL_BYTES ? "text-destructive" : ""}>{mb(totalSize)}</span>
                    </li>
                  </ul>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  .xlsx atau .csv mengikuti Template Standar Impor. Maks. {MAX_FILES} file, {mb(MAX_FILE_BYTES)} per
                  file, total {mb(MAX_TOTAL_BYTES)}. Setiap file divalidasi terpisah; file yang ditolak tidak
                  menghalangi file lain. Untuk jenis campuran, pilih &ldquo;Deteksi otomatis&rdquo;.
                </p>
              </div>
            </div>
          ) : null}

          {method === "google_sheets" ? (
            <div className="grid gap-2">
              <Label htmlFor="sheet-url">URL Google Spreadsheet</Label>
              <Input
                id="sheet-url"
                name="sheetUrl"
                type="url"
                inputMode="url"
                required
                disabled={pending}
                placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0"
                aria-invalid={sheetErrors?.length ? true : undefined}
                aria-describedby={sheetErrors?.length ? "sheet-url-error" : undefined}
              />
              <FieldError id="sheet-url-error" errors={sheetErrors} />
              <p className="text-xs text-muted-foreground">
                Buka tab yang ingin diimpor lalu salin URL dari browser (berisi <code>#gid=…</code>). Atur berbagi ke
                &ldquo;Siapa saja yang memiliki link: Pelihat&rdquo;. Kolom harus sama dengan template standar; data
                melewati validasi yang sama dengan unggahan file.
              </p>
            </div>
          ) : null}

          {method === "api" ? (
            <div className="grid gap-4">
              <fieldset className="grid gap-2" disabled={pending}>
                <legend className="mb-2 text-sm font-medium">Platform</legend>
                <div className="flex flex-wrap gap-2">
                  {API_PLATFORMS.map((p) => (
                    <label
                      key={p.value}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                        "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                        platform === p.value ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                      )}
                    >
                      <input
                        type="radio"
                        name="platform"
                        value={p.value}
                        checked={platform === p.value}
                        onChange={() => setPlatform(p.value)}
                        className="size-4 accent-primary"
                      />
                      {p.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="text-xs text-muted-foreground">
                Toko dihubungkan melalui otorisasi resmi (OAuth) platform; aplikasi tidak pernah meminta password Seller
                Center. Tokopedia kini dikelola lewat TikTok Shop Partner API.
              </p>
              {!apiConfigured ? (
                <Alert>
                  <Info aria-hidden />
                  <AlertDescription>
                    Belum dikonfigurasi: dibutuhkan kredensial aplikasi partner (TikTok Shop Partner Center / Shopee
                    Open Platform). Sementara itu gunakan unggah file atau Google Spreadsheet.
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}

          {state.status === "error" && state.message ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}

          {state.status === "success" && state.message ? (
            <Alert>
              <CheckCircle2 aria-hidden />
              <AlertTitle>{state.message}</AlertTitle>
              <AlertDescription>Tinjau hasil validasi sebelum data di-commit.</AlertDescription>
            </Alert>
          ) : null}

          {state.result && (state.result.staged.length > 0 || state.result.rejected.length > 1) ? (
            <ul className="grid gap-2 text-sm">
              {state.result.staged.map((s) => (
                <li key={s.batchId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                  <span>
                    <span className="font-medium">{s.title}</span>
                    {s.tableName ? <span className="text-muted-foreground"> · {s.tableName}</span> : null}
                    <span className="block text-xs text-muted-foreground">
                      {s.outcome === "duplicate"
                        ? "Data yang persis sama sudah pernah diimpor."
                        : `${s.validRows} valid · ${s.invalidRows} ditolak · ${s.warningRows} peringatan dari ${s.totalRows} baris`}
                    </span>
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/imports/${s.batchId}`}>Lihat hasil</Link>
                  </Button>
                </li>
              ))}
              {state.result.rejected.map((r) => (
                <li key={r.tableName} className="rounded-md border border-destructive/40 p-3 text-destructive">
                  <span className="font-medium">{r.tableName}</span>: {r.message}
                </li>
              ))}
            </ul>
          ) : null}

          <div>
            <Button type="submit" disabled={pending || apiBlocked}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {pending ? "Memproses…" : SUBMIT_LABEL[method]}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
