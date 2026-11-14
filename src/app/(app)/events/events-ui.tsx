import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { formatIDR, MISSING } from "@/lib/format";
import { EVENT_STATUS_LABELS, type EVENT_STATUSES } from "@/lib/events/manage";
import type { Financials } from "@/lib/events/profit";
import { cn } from "@/lib/utils";

export const NUM = "text-right tabular-nums";
export const RESTRICTED = "Terbatas";

export const pct = (v: number | null, digits = 1) =>
  v === null || !Number.isFinite(v)
    ? MISSING
    : new Intl.NumberFormat("id-ID", {
        style: "percent",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(v);

/** Money that may be hidden (restricted) or unknown (missing COGS). */
export function money(v: number | null, restricted: boolean) {
  if (restricted) return RESTRICTED;
  return v === null ? MISSING : formatIDR(v);
}

export function ProfitText({ value, restricted }: { value: number | null; restricted: boolean }) {
  if (restricted) return <span className="text-muted-foreground">{RESTRICTED}</span>;
  if (value === null) return <span className="text-muted-foreground">{MISSING}</span>;
  return <span className={cn("tabular-nums", value < 0 && "text-destructive")}>{formatIDR(value)}</span>;
}

const STATUS_VARIANT: Record<(typeof EVENT_STATUSES)[number], "outline" | "warning" | "success" | "secondary"> = {
  rencana: "outline",
  berlangsung: "warning",
  selesai: "success",
  batal: "secondary",
};

export function EventStatusBadge({ status }: { status: (typeof EVENT_STATUSES)[number] }) {
  return <Badge variant={STATUS_VARIANT[status]}>{EVENT_STATUS_LABELS[status]}</Badge>;
}

export function EventsTabs({ active, showCogs }: { active: "events" | "cogs"; showCogs: boolean }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        on ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav className="flex gap-1" aria-label="Bagian Profitabilitas Event">
      {tab("/events", "Event", active === "events")}
      {showCogs ? tab("/events/cogs", "COGS produk", active === "cogs") : null}
    </nav>
  );
}

/** Profit & loss statement: event days only vs including post-event attribution. */
export function Statement({
  eventOnly,
  total,
  restricted,
}: {
  eventOnly: Financials;
  total: Financials;
  restricted: boolean;
}) {
  const rows: [string, (f: Financials) => React.ReactNode, boolean?][] = [
    ["Pendapatan bersih", (f) => formatIDR(f.revenue)],
    ["− COGS", (f) => money(f.cogs, restricted)],
    ["= Laba kotor", (f) => <ProfitText value={f.grossProfit} restricted={restricted} />, true],
    ["− Biaya variabel", (f) => formatIDR(f.variableCosts)],
    ["= Contribution profit", (f) => <ProfitText value={f.contribution} restricted={restricted} />, true],
    ["Contribution margin", (f) => (restricted ? RESTRICTED : pct(f.contributionMargin))],
    ["− Biaya tetap", (f) => formatIDR(f.fixedCosts)],
    ["= Laba bersih event", (f) => <ProfitText value={f.netProfit} restricted={restricted} />, true],
    ["ROI", (f) => (restricted ? RESTRICTED : pct(f.roi))],
    [
      "Pendapatan break-even",
      (f) =>
        restricted
          ? RESTRICTED
          : f.breakEvenRevenue === null
            ? "Tidak tercapai (margin ≤ 0)"
            : formatIDR(f.breakEvenRevenue),
    ],
  ];
  return (
    <Table>
      <thead>
        <tr className="border-b text-xs text-muted-foreground">
          <th className="px-2 py-2 text-left font-medium" />
          <th className="px-2 py-2 text-right font-medium">Hari event</th>
          <th className="px-2 py-2 text-right font-medium">+ Atribusi pasca-event</th>
        </tr>
      </thead>
      <TableBody>
        {rows.map(([label, cell, strong]) => (
          <TableRow key={label} className={strong ? "font-medium" : ""}>
            <TableCell>{label}</TableCell>
            <TableCell className={NUM}>{cell(eventOnly)}</TableCell>
            <TableCell className={NUM}>{cell(total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
