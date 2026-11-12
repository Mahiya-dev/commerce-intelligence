import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MISSING } from "@/lib/format";

/**
 * Compact KPI card. `value` null renders an explicit "no data" state instead
 * of a zero, so missing data is never mistaken for zero performance.
 */
export function KpiCard({
  label,
  value,
  hint,
  hintTone,
  icon: Icon,
}: {
  label: string;
  value: string | null;
  hint?: string;
  /** "warning" highlights the hint (e.g. below the organization's KPI target). */
  hintTone?: "warning";
  icon?: LucideIcon;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        {Icon ? <Icon className="size-4 text-muted-foreground" aria-hidden /> : null}
      </CardHeader>
      <CardContent className="space-y-1 px-4">
        <p
          className={
            value === null ? "text-2xl font-semibold text-muted-foreground/60" : "text-2xl font-semibold tabular-nums"
          }
        >
          {value ?? MISSING}
        </p>
        {hint ? (
          <p className={hintTone === "warning" ? "text-xs text-warning-foreground" : "text-xs text-muted-foreground"}>
            {hint}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
