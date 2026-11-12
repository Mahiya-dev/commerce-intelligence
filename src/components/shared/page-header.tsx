import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/shared/demo-badge";
import { CURRENT_PHASE } from "@/config/navigation";

export function PageHeader({
  title,
  description,
  phase,
  isDemo,
  actions,
}: {
  title: string;
  description?: string;
  /** Delivery phase; shown as a badge while the module is not yet live. */
  phase?: number;
  isDemo?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          {isDemo ? <DemoBadge /> : null}
          {phase && phase > CURRENT_PHASE ? <Badge variant="outline">Tersedia di Fase {phase}</Badge> : null}
        </div>
        {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
