import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, DatabaseZap, Info } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { formatDateTime, MISSING } from "@/lib/format";
import { REPORT_TYPE_LABELS, TEMPLATE_LIST } from "@/lib/imports/templates";
import { getImportBatch } from "@/lib/imports/staging";
import { canCommitReportType, previewCommit, type CommitPlan } from "@/lib/imports/commit";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cancelImport, commitImport } from "../actions";
import { BatchStatusBadge, formatPeriod, SOURCE_LABELS } from "../batch-ui";

export const metadata: Metadata = { title: "Hasil Impor" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function Stat({ label, value, tone }: { label: string; value: number | null; tone?: "bad" | "warn" }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          "text-xl font-semibold tabular-nums " +
          (tone === "bad" && value ? "text-destructive" : tone === "warn" && value ? "text-warning-foreground" : "")
        }
      >
        {value ?? MISSING}
      </p>
    </div>
  );
}

const COMMIT_MESSAGES: Record<string, { tone: "ok" | "bad"; text: string }> = {
  ok: {
    tone: "ok",
    text: "Data tersimpan ke data e-commerce. Dashboard dan halaman E-Commerce sudah memakai data ini.",
  },
  invalid_rows: { tone: "bad", text: "Batch ini memiliki baris yang ditolak. Perbaiki file lalu impor ulang." },
  warnings_not_acknowledged: {
    tone: "bad",
    text: "Centang konfirmasi bahwa peringatan sudah ditinjau, lalu simpan lagi.",
  },
  unknown_skus: { tone: "bad", text: "Ada SKU internal yang tidak ditemukan di Master Produk (lihat di bawah)." },
  status: { tone: "bad", text: "Batch ini tidak lagi dapat disimpan (sudah tersimpan atau dibatalkan)." },
  empty: { tone: "bad", text: "Tidak ada baris valid untuk disimpan." },
  targets_forbidden: { tone: "bad", text: "Target bulanan hanya dapat disimpan oleh Admin atau Owner." },
  error: { tone: "bad", text: "Penyimpanan gagal karena gangguan layanan. Tidak ada data yang berubah; coba lagi." },
};

const PLAN_NOUN: Record<string, string> = {
  marketplace_sales_daily: "baris kinerja toko harian",
  marketplace_product_performance: "baris kinerja produk harian",
  sales_target: "target bulanan",
  channel_listing_master: "listing",
  touchpoint_performance: "baris kinerja touchpoint harian",
  meta_ads_performance: "baris performa iklan Meta harian",
  shopee_hsl_affiliate: "baris penjualan afiliasi HSL",
};

function CommitPanel({ batchId, plan, warningRows }: { batchId: string; plan: CommitPlan; warningRows: number }) {
  const noun = PLAN_NOUN[plan.reportType] ?? "baris";
  const blocked = plan.unknownSkus.length > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Simpan ke data e-commerce</CardTitle>
        <CardDescription>
          Menyimpan {plan.rows.toLocaleString("id-ID")} {noun} sekaligus (semua atau tidak sama sekali).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="list-inside list-disc space-y-1 text-sm">
          <li>
            <span className="font-medium tabular-nums">{plan.inserts.toLocaleString("id-ID")}</span> data baru
          </li>
          <li>
            <span className="font-medium tabular-nums">{plan.overwrites.toLocaleString("id-ID")}</span> data yang sudah
            ada akan <span className="font-medium">ditimpa</span> oleh file ini
          </li>
          {plan.newListings > 0 ? (
            <li>
              <span className="font-medium tabular-nums">{plan.newListings.toLocaleString("id-ID")}</span> listing baru
              dibuat{plan.autoMapped > 0 ? "" : " sebagai "}
              {plan.autoMapped > 0 ? null : <span className="font-medium">belum dipetakan</span>}
              {plan.autoMapped > 0 ? "" : " (tetap dihitung di total channel; petakan lewat impor Master Listing)"}
            </li>
          ) : null}
          {plan.autoMapped > 0 ? (
            <li>
              <span className="font-medium tabular-nums">{plan.autoMapped.toLocaleString("id-ID")}</span> listing
              otomatis <span className="font-medium">dipetakan ke SKU internal</span> lewat kolom SKU (mis. SKU Induk
              Shopee). Listing yang sudah dipetakan tidak diubah.
            </li>
          ) : null}
        </ul>
        {plan.unmatchedSkus.length > 0 ? (
          <Alert>
            <Info aria-hidden />
            <AlertDescription>
              SKU berikut tidak ada di Master Produk, jadi listing-nya tetap belum dipetakan (data tetap tersimpan dan
              dihitung di total channel): {plan.unmatchedSkus.join(", ")}. Tambahkan SKU tersebut di Master Produk lalu
              impor ulang file ini, atau petakan lewat Master Listing.
            </AlertDescription>
          </Alert>
        ) : null}
        {blocked ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden />
            <AlertDescription>
              SKU internal berikut tidak ada di Master Produk: {plan.unknownSkus.join(", ")}. Tambahkan SKU tersebut
              atau perbaiki file, lalu impor ulang.
            </AlertDescription>
          </Alert>
        ) : (
          <form action={commitImport} className="space-y-3">
            <input type="hidden" name="batchId" value={batchId} />
            {warningRows > 0 ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="acknowledgeWarnings" required className="mt-1" />
                <span>
                  Saya sudah meninjau {warningRows.toLocaleString("id-ID")} baris dengan peringatan dan datanya benar.
                </span>
              </label>
            ) : null}
            <Button type="submit">
              <DatabaseZap aria-hidden /> Simpan ke data e-commerce
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default async function ImportBatchPage({ params, searchParams }: PageProps<"/imports/[batchId]">) {
  const item = requireNavItem("/imports");
  const session = await requireRole(item.minRole);
  const { batchId } = await params;
  const commitParam = (await searchParams).commit;
  const commitMessage = typeof commitParam === "string" ? COMMIT_MESSAGES[commitParam] : undefined;
  if (!UUID_RE.test(batchId)) notFound();
  const detail = await getImportBatch(session, batchId);
  if (!detail) notFound();

  const { batch, issueRows, preview, warningRows } = detail;
  const tz = session.organization.timezone;
  const template = TEMPLATE_LIST.find((t) => t.dbReportType === batch.reportType);
  const columns = template?.columns.map((c) => c.name) ?? Object.keys(preview[0]?.normalized ?? {});
  const cancellable = ["uploaded", "validated", "failed"].includes(batch.status);
  const committable = batch.status === "validated" && (batch.invalidRows ?? 0) === 0 && (batch.validRows ?? 0) > 0;
  const mayCommit = canCommitReportType(session, batch.reportType);
  const plan = committable && mayCommit ? await previewCommit(session, batch.id) : null;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/imports">
            <ArrowLeft aria-hidden /> Impor Data
          </Link>
        </Button>
      </div>
      <PageHeader
        title={REPORT_TYPE_LABELS[batch.reportType] ?? batch.reportType}
        description={`${SOURCE_LABELS[batch.sourceKind]}: ${batch.fileName}`}
        isDemo={session.organization.isDemo}
        actions={<BatchStatusBadge status={batch.status} />}
      />

      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Diimpor</dt>
        <dd>
          {formatDateTime(batch.createdAt, tz)}
          {batch.createdBy ? ` oleh ${batch.createdBy}` : ""}
        </dd>
        <dt className="text-muted-foreground">Periode</dt>
        <dd>{formatPeriod(batch.periodStart, batch.periodEnd)}</dd>
        <dt className="text-muted-foreground">Channel</dt>
        <dd>{batch.channelName ?? "Beberapa channel"}</dd>
        {batch.sourceRef ? (
          <>
            <dt className="text-muted-foreground">Sumber</dt>
            <dd className="break-all">
              <a
                href={batch.sourceRef}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-4"
              >
                {batch.sourceRef}
              </a>
            </dd>
          </>
        ) : null}
      </dl>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total baris" value={batch.totalRows} />
        <Stat label="Valid" value={batch.validRows} />
        <Stat label="Ditolak (error)" value={batch.invalidRows} tone="bad" />
        <Stat label="Valid dengan peringatan" value={warningRows} tone="warn" />
      </div>

      {commitMessage ? (
        <Alert variant={commitMessage.tone === "bad" ? "destructive" : "default"}>
          {commitMessage.tone === "bad" ? <AlertTriangle aria-hidden /> : <CheckCircle2 aria-hidden />}
          <AlertDescription>{commitMessage.text}</AlertDescription>
        </Alert>
      ) : null}

      {batch.status === "validated" && !committable ? (
        <Alert>
          <Info aria-hidden />
          <AlertDescription>
            Batch dengan baris yang ditolak tidak dapat disimpan sebagian, karena data harian yang hilang membuat GMV
            terlihat lebih kecil dari kenyataan. Perbaiki file lalu impor ulang; batch ini dapat dibatalkan.
          </AlertDescription>
        </Alert>
      ) : null}

      {plan ? <CommitPanel batchId={batch.id} plan={plan} warningRows={warningRows} /> : null}
      {committable && !mayCommit ? (
        <Alert>
          <Info aria-hidden />
          <AlertDescription>
            File target sudah lolos validasi. Target bulanan menentukan status On Track / Watch / At Risk, jadi hanya
            Admin atau Owner yang dapat menyimpannya. Minta Admin membuka batch ini dari menu Impor Data lalu klik
            simpan.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Hasil validasi</CardTitle>
          <CardDescription>
            Baris dengan error ditolak; baris dengan peringatan tetap valid tetapi perlu ditinjau.
            {issueRows.length >= 200 ? " Menampilkan 200 baris pertama." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {issueRows.length === 0 ? (
            <p className="flex items-center gap-2 px-6 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4" aria-hidden /> Tidak ada error maupun peringatan.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Baris</TableHead>
                  <TableHead className="w-28">Tingkat</TableHead>
                  <TableHead className="w-40">Kolom</TableHead>
                  <TableHead>Pesan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issueRows.flatMap((r) =>
                  r.issues.map((i, n) => (
                    <TableRow key={`${r.line}-${n}`}>
                      <TableCell className="tabular-nums">{r.line}</TableCell>
                      <TableCell>
                        {i.severity === "error" ? (
                          <Badge variant="destructive">Error</Badge>
                        ) : (
                          <Badge variant="warning">Peringatan</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{i.column}</TableCell>
                      <TableCell className="whitespace-normal">{i.message}</TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pratinjau data valid</CardTitle>
          <CardDescription>
            {preview.length ? `${preview.length} baris valid pertama setelah normalisasi.` : "Tidak ada baris valid."}
          </CardDescription>
        </CardHeader>
        {preview.length ? (
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Baris</TableHead>
                  {columns.map((c) => (
                    <TableHead key={c} className="font-mono text-xs">
                      {c}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((r) => (
                  <TableRow key={r.line}>
                    <TableCell className="tabular-nums">{r.line}</TableCell>
                    {columns.map((c) => {
                      const v = r.normalized[c];
                      return (
                        <TableCell key={c} className={typeof v === "number" ? "text-right tabular-nums" : ""}>
                          {v === null || v === undefined ? (
                            <span className="text-muted-foreground">{MISSING}</span>
                          ) : typeof v === "number" ? (
                            v.toLocaleString("id-ID")
                          ) : (
                            v
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        ) : null}
      </Card>

      {cancellable ? (
        <form action={cancelImport}>
          <input type="hidden" name="batchId" value={batch.id} />
          <Button type="submit" variant="outline">
            <Ban aria-hidden /> Batalkan batch
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Batch yang dibatalkan tidak dihapus (jejak audit tetap ada) dan file yang sama dapat diimpor ulang.
          </p>
        </form>
      ) : null}
    </div>
  );
}
