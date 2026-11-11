import { Database, Clock } from "lucide-react";
import { formatDateTime } from "@/lib/format";

/**
 * Freshness + provenance label. Every data view must show where its numbers
 * come from and when they were last updated; "Belum ada data" is explicit.
 */
export function DataSourceLabel({
  source,
  updatedAt,
  timeZone,
}: {
  source: string;
  updatedAt?: string | null;
  timeZone?: string;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Database className="size-3.5" aria-hidden />
        Sumber: {source}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Clock className="size-3.5" aria-hidden />
        {updatedAt ? `Diperbarui ${formatDateTime(updatedAt, timeZone)}` : "Belum ada data"}
      </span>
    </p>
  );
}
