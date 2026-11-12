import type { Metadata } from "next";
import Link from "next/link";
import { History } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { isDatabaseConfigured } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { REPORT_TYPE_LABELS } from "@/lib/imports/templates";
import { listImportBatches } from "@/lib/imports/staging";
import { PageHeader } from "@/components/shared/page-header";
import { DataSourceLabel } from "@/components/shared/data-source-label";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ImportSourcePicker } from "./import-source-picker";
import { BatchStatusBadge, formatPeriod, SOURCE_LABELS } from "./batch-ui";

export const metadata: Metadata = { title: "Impor Data" };

export default async function Page() {
  const item = requireNavItem("/imports");
  const session = await requireRole(item.minRole);
  const { organization } = session;
  const batches = isDatabaseConfigured() ? await listImportBatches(session) : [];

  return (
    <div className="space-y-6">
      <PageHeader title={item.title} description={item.description} isDemo={organization.isDemo} />
      <DataSourceLabel
        source="Excel / CSV · Google Spreadsheet · API marketplace"
        updatedAt={batches[0]?.createdAt ?? null}
        timeZone={organization.timezone}
      />
      <ImportSourcePicker />

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Riwayat impor</h2>
        {batches.length === 0 ? (
          <EmptyState
            icon={History}
            title="Belum ada impor"
            description="Batch yang diunggah atau ditarik akan muncul di sini beserta hasil validasinya."
          />
        ) : (
          <Card className="py-0">
            <CardHeader className="sr-only">
              <CardTitle>Riwayat impor</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Jenis laporan</TableHead>
                    <TableHead>Sumber</TableHead>
                    <TableHead>Periode</TableHead>
                    <TableHead className="text-right">Valid / total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="whitespace-nowrap">
                        <Link href={`/imports/${b.id}`} className="underline-offset-4 hover:underline">
                          {formatDateTime(b.createdAt, organization.timezone)}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {REPORT_TYPE_LABELS[b.reportType] ?? b.reportType}
                        {b.channelName ? <span className="text-muted-foreground"> · {b.channelName}</span> : null}
                      </TableCell>
                      <TableCell className="max-w-64 truncate" title={b.fileName}>
                        <span className="text-muted-foreground">{SOURCE_LABELS[b.sourceKind]}:</span> {b.fileName}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatPeriod(b.periodStart, b.periodEnd)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.validRows ?? "—"} / {b.totalRows ?? "—"}
                      </TableCell>
                      <TableCell>
                        <BatchStatusBadge status={b.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
