import { Badge } from "@/components/ui/badge";
import { MISSING } from "@/lib/format";
import type { TargetStatus } from "@/lib/ecommerce/kpi";

const STATUS: Record<TargetStatus, { label: string; variant: "success" | "warning" | "destructive" }> = {
  on_track: { label: "On Track", variant: "success" },
  watch: { label: "Watch", variant: "warning" },
  at_risk: { label: "At Risk", variant: "destructive" },
};

export const TARGET_STATUS_LABEL: Record<TargetStatus, string> = {
  on_track: "On Track",
  watch: "Watch",
  at_risk: "At Risk",
};

export function TargetStatusBadge({ status }: { status: TargetStatus | null }) {
  if (!status) return <span className="text-muted-foreground">{MISSING}</span>;
  const s = STATUS[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/** Signed percentage change ("+4,2%" / "−10,5%"); null renders "—". */
export function formatChange(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return MISSING;
  const pct = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(
    Math.abs(value) * 100,
  );
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${pct}%`;
}

export function ChangeText({ value }: { value: number | null }) {
  const tone = value === null ? "text-muted-foreground" : value < 0 ? "text-destructive" : "text-success";
  return <span className={`tabular-nums ${tone}`}>{formatChange(value)}</span>;
}
