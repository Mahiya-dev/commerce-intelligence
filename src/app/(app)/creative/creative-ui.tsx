import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { MISSING } from "@/lib/format";
import { FATIGUE_LABELS, type FatigueStatus } from "@/lib/creative/creative";
import { cn } from "@/lib/utils";

/** Shared formatting + small pieces for the Kreatif Meta pages. */
export const NUM = "text-right tabular-nums";

export const pct = (v: number | null, digits = 2) =>
  v === null || !Number.isFinite(v)
    ? MISSING
    : new Intl.NumberFormat("id-ID", {
        style: "percent",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(v);

export const signed = (v: number | null) =>
  v === null || !Number.isFinite(v) ? MISSING : `${v > 0 ? "+" : v < 0 ? "−" : ""}${pct(Math.abs(v), 1)}`;

export const roasText = (v: number | null) =>
  v === null
    ? MISSING
    : `${new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}×`;

export const decimal = (v: number | null, digits = 1) =>
  v === null ? MISSING : new Intl.NumberFormat("id-ID", { maximumFractionDigits: digits }).format(v);

export const change = (cur: number | null, prev: number | null) =>
  cur === null || prev === null || prev === 0 ? null : cur / prev - 1;

const FATIGUE_VARIANT: Record<FatigueStatus, "destructive" | "warning" | "success" | "outline"> = {
  lelah: "destructive",
  waspada: "warning",
  sehat: "success",
  belum_cukup: "outline",
};

export function FatigueBadge({ status }: { status: FatigueStatus }) {
  return <Badge variant={FATIGUE_VARIANT[status]}>{FATIGUE_LABELS[status]}</Badge>;
}

export function CreativeTabs({ active }: { active: "overview" | "assets" }) {
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
    <nav className="flex gap-1" aria-label="Bagian Kreatif Meta">
      {tab("/creative", "Ringkasan", active === "overview")}
      {tab("/creative/assets", "Library aset", active === "assets")}
    </nav>
  );
}
