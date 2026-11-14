import { QUADRANT_DESCRIPTIONS, QUADRANT_LABELS, type Quadrant } from "@/lib/portfolio/portfolio";
import { MISSING } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Quadrant label. Identity is the TEXT (never color alone); the dot uses the
 * quadrant's position in the matrix legend order for a quick scan.
 */
const DOT: Record<Quadrant, string> = {
  bintang: "bg-chart-1",
  penopang: "bg-chart-3",
  potensial: "bg-chart-2",
  evaluasi: "bg-muted-foreground",
  baru: "bg-transparent border border-muted-foreground",
};

export function QuadrantBadge({ quadrant, compact = false }: { quadrant: Quadrant | null; compact?: boolean }) {
  if (!quadrant) return <span className="text-muted-foreground">{MISSING}</span>;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap"
      title={QUADRANT_DESCRIPTIONS[quadrant]}
    >
      <span className={cn("inline-block size-2 shrink-0 rounded-full", DOT[quadrant])} aria-hidden />
      {compact ? QUADRANT_LABELS[quadrant].slice(0, 3) : QUADRANT_LABELS[quadrant]}
    </span>
  );
}
