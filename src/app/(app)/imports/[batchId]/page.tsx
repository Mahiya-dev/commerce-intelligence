import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, CheckCircle2, Info } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { formatDateTime, MISSING } from "@/lib/format";
import { REPORT_TYPE_LABELS, TEMPLATE_LIST } from "@/lib/imports/templates";
import { getImportBatch } from "@/lib/imports/staging";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cancelImport } from "../actions";
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

export default async function ImportBatchPage({ params }: PageProps<"/imports/[batchId]">) {
  const item = requireNavItem("/imports");
  const session = await requireRole(item.minRole);
  const { batchId } = await params;
  if (!UUID_RE.test(batchId)) notFound();
  const detail = await getImportBatch(session, batchId);
  if (!detail) notFound();

  const { batch, issueRows, preview, warningRows } = detail;
  const tz = session.organization.timezone;
  const template = TEMPLATE_LIST.find((t) => t.dbReportType === batch.reportType);
  const columns = template?.columns.map((c) => c.name) ?? Object.keys(preview[0]?.normalized ?? {});
  const cancellable = ["uploaded", "validated", "failed"].includes(batch.status);

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

      {batch.status === "validated" ? (
        <Alert>
          <Info aria-hidden />
          <AlertDescription>
            Data sudah divalidasi dan tersimpan sebagai staging. Penyimpanan ke data e-commerce (commit) akan aktif
            setelah tabel fakta penjualan tersedia. Baris yang ditolak tidak akan pernah di-commit; perbaiki file lalu
            impor ulang.
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
