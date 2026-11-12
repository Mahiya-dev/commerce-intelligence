"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

/**
 * Shared hover/focus tooltip for the SVG charts. Tooltips enhance, never gate:
 * every value is also in a table on the same page. Content is rendered as
 * React text (never innerHTML), so labels from imported data are safe.
 */
export type TooltipRow = { key?: string; color?: string; label: string; value: string };
export type TooltipContent = { title: string; rows: TooltipRow[] };

export function useChartTooltip() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; content: TooltipContent } | null>(null);

  /** Show the tooltip anchored above the hovered/focused element. */
  const show = useCallback((el: Element, content: TooltipContent) => {
    const box = containerRef.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!box) return;
    setTip({ x: r.left + r.width / 2 - box.left, y: r.top - box.top, content });
  }, []);
  const hide = useCallback(() => setTip(null), []);

  return { containerRef, tip, show, hide };
}

export function ChartTooltip({
  tip,
  width,
}: {
  tip: { x: number; y: number; content: TooltipContent } | null;
  width?: number;
}) {
  if (!tip) return null;
  const left = width ? Math.min(Math.max(tip.x, 90), width - 90) : tip.x;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
      style={{ left, top: tip.y - 8 }}
    >
      <p className="mb-1 text-muted-foreground">{tip.content.title}</p>
      <ul className="grid gap-0.5">
        {tip.content.rows.map((r) => (
          <li key={r.key ?? r.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {r.color ? (
                <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: r.color }} />
              ) : null}
              {r.label}
            </span>
            <span className="font-semibold tabular-nums">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartFrame({
  children,
  containerRef,
  tooltip,
  label,
}: {
  children: ReactNode;
  containerRef: React.RefObject<HTMLDivElement | null>;
  tooltip: ReactNode;
  /** Accessible summary of the chart. */
  label: string;
}) {
  return (
    <div ref={containerRef} className="relative w-full" role="figure" aria-label={label}>
      {children}
      {tooltip}
    </div>
  );
}

/** Rupiah in compact form for axes/labels: "Rp12,3 jt". */
export function rupiahCompact(v: number): string {
  const abs = Math.abs(v);
  const f = (n: number, unit: string) =>
    `Rp${new Intl.NumberFormat("id-ID", { maximumFractionDigits: n < 10 ? 1 : 0 }).format(n)}${unit}`;
  if (abs >= 1e9) return f(v / 1e9, " M");
  if (abs >= 1e6) return f(v / 1e6, " jt");
  if (abs >= 1e3) return f(v / 1e3, " rb");
  return `Rp${v}`;
}

/** Clean axis ticks from 0 to ≥ max (4–6 steps of 1/2/2.5/5 × 10^n). */
export function niceTicks(max: number, target = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** Column path with a 4px rounded top (data end) and a square base. */
export function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
