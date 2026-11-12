import { Badge } from "@/components/ui/badge";
import { formatDate, MISSING } from "@/lib/format";
import type { BatchStatus } from "@/lib/imports/staging";
import type { ImportSourceKind } from "@/lib/imports/sources";

const STATUS: Record<
  BatchStatus,
  { label: string; variant: "default" | "secondary" | "outline" | "success" | "warning" | "destructive" }
> = {
  uploaded: { label: "Diunggah", variant: "secondary" },
  validating: { label: "Memvalidasi", variant: "secondary" },
  validated: { label: "Tervalidasi", variant: "warning" },
  committing: { label: "Menyimpan", variant: "secondary" },
  committed: { label: "Tersimpan", variant: "success" },
  failed: { label: "Gagal", variant: "destructive" },
  cancelled: { label: "Dibatalkan", variant: "outline" },
};

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const s = STATUS[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export const SOURCE_LABELS: Record<ImportSourceKind, string> = {
  file_upload: "Unggah file",
  google_sheets: "Google Spreadsheet",
  marketplace_api: "API marketplace",
};

/** Batch period; DATE values are calendar dates, so format in UTC. */
export function formatPeriod(start: string | null, end: string | null): string {
  if (!start || !end) return MISSING;
  return start === end ? formatDate(start, "UTC") : `${formatDate(start, "UTC")} – ${formatDate(end, "UTC")}`;
}
