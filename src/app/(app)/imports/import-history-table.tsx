"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AlertCircle, Ban, CheckCircle2, DatabaseZap, Loader2 } from "lucide-react";
import { bulkImportAction, type BulkImportState } from "./actions";
import { BatchStatusBadge } from "./batch-ui";
import type { BatchStatus } from "@/lib/imports/staging";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type HistoryRow = {
  id: string;
  time: string;
  type: string;
  channel: string | null;
  source: string;
  fileName: string;
  period: string;
  validRows: number | null;
  totalRows: number | null;
  status: BatchStatus;
};

const INITIAL: BulkImportState = { status: "idle" };
/** Statuses a bulk action can still change (save: validated; cancel: uploaded/validated/failed). */
const SELECTABLE: BatchStatus[] = ["uploaded", "validated", "failed"];
const CHECKBOX =
  "size-4 cursor-pointer rounded border-input accent-primary disabled:cursor-not-allowed disabled:opacity-40";

/** Import history with row checkboxes and bulk "save" / "cancel". Selection is per page. */
export function ImportHistoryTable({ rows }: { rows: HistoryRow[] }) {
  const [state, formAction, pending] = useActionState(bulkImportAction, INITIAL);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const selectable = rows.filter((r) => SELECTABLE.includes(r.status));
  // Rows change status after an action; only count those that are still selectable.
  const selected = selectable.filter((r) => picked.has(r.id));
  const allSelected = selectable.length > 0 && selected.length === selectable.length;
  const savable = selected.filter((r) => r.status === "validated").length;
  const nameOf = (id: string) => rows.find((r) => r.id === id)?.fileName ?? id;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <form action={formAction} className="grid gap-3">
      <div className="flex min-h-9 flex-wrap items-center gap-3 px-4 pt-3 text-sm">
        <span className="text-muted-foreground tabular-nums">{selected.length} dipilih</span>
        <Button type="submit" name="intent" value="commit" size="sm" disabled={pending || savable === 0}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <DatabaseZap aria-hidden />}
          Simpan yang dipilih{savable ? ` (${savable})` : ""}
        </Button>
        <Button
          type="submit"
          name="intent"
          value="cancel"
          size="sm"
          variant="outline"
          disabled={pending || selected.length === 0}
          onClick={(e) => {
            if (!confirm(`Batalkan ${selected.length} impor yang dipilih?`)) e.preventDefault();
          }}
        >
          <Ban aria-hidden /> Batalkan yang dipilih
        </Button>
        <label className="flex items-center gap-2 text-muted-foreground">
          <input type="checkbox" name="acknowledgeWarnings" className={CHECKBOX} />
          Peringatan sudah saya tinjau
        </label>
      </div>

      {state.status !== "idle" && state.message ? (
        <div className="px-4">
          <Alert variant={state.status === "error" ? "destructive" : "default"}>
            {state.status === "error" ? <AlertCircle aria-hidden /> : <CheckCircle2 aria-hidden />}
            <AlertDescription>
              <p>{state.message}</p>
              {state.skipped?.length ? (
                <ul className="mt-1 list-disc pl-5">
                  {state.skipped.map((s) => (
                    <li key={s.batchId}>
                      <Link href={`/imports/${s.batchId}`} className="underline underline-offset-4">
                        {nameOf(s.batchId)}
                      </Link>
                      : {s.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 pl-4">
              <input
                type="checkbox"
                className={CHECKBOX}
                aria-label="Pilih semua impor di halaman ini"
                checked={allSelected}
                disabled={selectable.length === 0}
                onChange={() => setPicked(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))}
              />
            </TableHead>
            <TableHead>Waktu</TableHead>
            <TableHead>Jenis laporan</TableHead>
            <TableHead>Sumber</TableHead>
            <TableHead>Periode</TableHead>
            <TableHead className="text-right">Valid / total</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Tindakan</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((b) => {
            const canSelect = SELECTABLE.includes(b.status);
            return (
              <TableRow key={b.id} data-state={canSelect && picked.has(b.id) ? "selected" : undefined}>
                <TableCell className="pl-4">
                  <input
                    type="checkbox"
                    name="batchId"
                    value={b.id}
                    className={CHECKBOX}
                    aria-label={`Pilih ${b.fileName}`}
                    checked={canSelect && picked.has(b.id)}
                    disabled={!canSelect}
                    title={canSelect ? undefined : "Sudah tersimpan atau dibatalkan"}
                    onChange={() => toggle(b.id)}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Link href={`/imports/${b.id}`} className="underline-offset-4 hover:underline">
                    {b.time}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {b.type}
                  {b.channel ? <span className="text-muted-foreground"> · {b.channel}</span> : null}
                </TableCell>
                <TableCell className="max-w-64 truncate" title={b.fileName}>
                  <span className="text-muted-foreground">{b.source}:</span> {b.fileName}
                </TableCell>
                <TableCell className="whitespace-nowrap">{b.period}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {b.validRows ?? "—"} / {b.totalRows ?? "—"}
                </TableCell>
                <TableCell>
                  <BatchStatusBadge status={b.status} />
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant={b.status === "validated" ? "default" : "outline"}>
                    <Link href={`/imports/${b.id}`}>
                      {b.status === "validated" ? "Tinjau & simpan" : "Lihat hasil"}
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </form>
  );
}
