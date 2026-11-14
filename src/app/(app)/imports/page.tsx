import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { isDatabaseConfigured } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { REPORT_TYPE_LABELS } from "@/lib/imports/templates";
import { IMPORT_HISTORY_PAGE_SIZE, listImportBatchesPage } from "@/lib/imports/staging";
import { PageHeader } from "@/components/shared/page-header";
import { DataSourceLabel } from "@/components/shared/data-source-label";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportSourcePicker } from "./import-source-picker";
import { formatPeriod, SOURCE_LABELS } from "./batch-ui";
import { ImportHistoryTable } from "./import-history-table";

export const metadata: Metadata = { title: "Impor Data" };

function PageLink({ page, disabled, children }: { page: number; disabled: boolean; children: React.ReactNode }) {
  if (disabled) {
    return (
      <Button size="sm" variant="outline" disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild size="sm" variant="outline">
      <Link href={page <= 1 ? "/imports" : `/imports?page=${page}`} scroll={false}>
        {children}
      </Link>
    </Button>
  );
}

export default async function Page({ searchParams }: PageProps<"/imports">) {
  const item = requireNavItem("/imports");
  const session = await requireRole(item.minRole);
  const { organization } = session;
  const pageParam = (await searchParams).page;
  const requested = Number.parseInt(Array.isArray(pageParam) ? (pageParam[0] ?? "") : (pageParam ?? ""), 10) || 1;
  const history = isDatabaseConfigured()
    ? await listImportBatchesPage(session, requested)
    : { items: [], total: 0, page: 1, pageCount: 1 };
  const batches = history.items;

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
              <ImportHistoryTable
                key={history.page}
                rows={batches.map((b) => ({
                  id: b.id,
                  time: formatDateTime(b.createdAt, organization.timezone),
                  type: REPORT_TYPE_LABELS[b.reportType] ?? b.reportType,
                  channel: b.channelName,
                  source: SOURCE_LABELS[b.sourceKind],
                  fileName: b.fileName,
                  period: formatPeriod(b.periodStart, b.periodEnd),
                  validRows: b.validRows,
                  totalRows: b.totalRows,
                  status: b.status,
                }))}
              />
              <nav
                aria-label="Halaman riwayat impor"
                className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm"
              >
                <span className="text-muted-foreground tabular-nums">
                  {(history.page - 1) * IMPORT_HISTORY_PAGE_SIZE + 1}–
                  {(history.page - 1) * IMPORT_HISTORY_PAGE_SIZE + batches.length} dari {history.total} impor
                </span>
                <div className="flex items-center gap-2">
                  <PageLink page={history.page - 1} disabled={history.page <= 1}>
                    <ChevronLeft aria-hidden /> Sebelumnya
                  </PageLink>
                  <span className="tabular-nums">
                    Halaman {history.page} dari {history.pageCount}
                  </span>
                  <PageLink page={history.page + 1} disabled={history.page >= history.pageCount}>
                    Berikutnya <ChevronRight aria-hidden />
                  </PageLink>
                </div>
              </nav>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
