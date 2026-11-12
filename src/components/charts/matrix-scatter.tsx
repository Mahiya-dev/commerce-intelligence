"use client";

import { ChartFrame, ChartTooltip, rupiahCompact, useChartTooltip } from "./chart-tooltip";

export type MatrixPoint = {
  sku: string;
  name: string;
  share: number;
  growth: number;
  gmv: number;
  quadrantLabel: string;
};

const W = 640;
const H = 380;
const PAD = { top: 20, right: 24, bottom: 40, left: 56 };

const pct = (v: number, digits = 0) =>
  `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v * 100)}%`;
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${pct(Math.abs(v), 1)}`;

/**
 * Portfolio matrix: x = GMV share, y = MoM growth, split by the two
 * thresholds. Position IS the quadrant, so every point uses one color
 * (single series, no legend) and carries a direct SKU label.
 */
export function MatrixScatter({
  points,
  shareThreshold,
  growthThreshold,
  quadrantNames,
  label,
}: {
  points: MatrixPoint[];
  shareThreshold: number;
  growthThreshold: number;
  /** [top-left, top-right, bottom-left, bottom-right] */
  quadrantNames: [string, string, string, string];
  label: string;
}) {
  const { containerRef, tip, show, hide } = useChartTooltip();
  const xMax = Math.max(shareThreshold * 2, ...points.map((p) => p.share)) * 1.1;
  const gs = points.map((p) => p.growth);
  const yMin = Math.min(growthThreshold - 0.2, ...gs) - 0.05;
  const yMax = Math.max(growthThreshold + 0.2, ...gs) + 0.05;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (v: number) => PAD.left + (v / xMax) * plotW;
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const xTicks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].filter((t) => t <= xMax);
  const yStep = yMax - yMin > 1.2 ? 0.5 : yMax - yMin > 0.6 ? 0.25 : 0.1;
  const yTicks: number[] = [];
  for (let t = Math.ceil(yMin / yStep) * yStep; t <= yMax; t += yStep) yTicks.push(Math.round(t * 100) / 100);
  const corner = "fill-muted-foreground text-[11px] font-medium uppercase tracking-wide";

  return (
    <ChartFrame containerRef={containerRef} label={label} tooltip={<ChartTooltip tip={tip} />}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" onPointerLeave={hide}>
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px]">
              {signed(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={x(t)} y={H - 22} textAnchor="middle" className="fill-muted-foreground text-[10px]">
            {pct(t)}
          </text>
        ))}
        <text x={PAD.left + plotW / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          Porsi GMV →
        </text>
        <text
          transform={`translate(12 ${PAD.top + plotH / 2}) rotate(-90)`}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          Pertumbuhan MoM →
        </text>

        {/* Thresholds: the quadrant boundaries. */}
        <line
          x1={x(shareThreshold)}
          x2={x(shareThreshold)}
          y1={PAD.top}
          y2={PAD.top + plotH}
          stroke="currentColor"
          className="text-muted-foreground/60"
          strokeWidth={1}
        />
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y(growthThreshold)}
          y2={y(growthThreshold)}
          stroke="currentColor"
          className="text-muted-foreground/60"
          strokeWidth={1}
        />
        <text x={PAD.left + 6} y={PAD.top + 12} className={corner}>
          {quadrantNames[0]}
        </text>
        <text x={W - PAD.right - 6} y={PAD.top + 12} textAnchor="end" className={corner}>
          {quadrantNames[1]}
        </text>
        <text x={PAD.left + 6} y={PAD.top + plotH - 8} className={corner}>
          {quadrantNames[2]}
        </text>
        <text x={W - PAD.right - 6} y={PAD.top + plotH - 8} textAnchor="end" className={corner}>
          {quadrantNames[3]}
        </text>

        {points.map((p) => {
          const cx = x(p.share);
          const cy = y(p.growth);
          const right = cx < W - PAD.right - 90;
          const content = {
            title: `${p.sku} · ${p.quadrantLabel}`,
            rows: [
              { label: p.name, value: "" },
              { label: "Porsi GMV", value: pct(p.share, 1) },
              { label: "Pertumbuhan", value: signed(p.growth) },
              { label: "GMV", value: rupiahCompact(p.gmv) },
            ],
          };
          return (
            <g key={p.sku}>
              <circle cx={cx} cy={cy} r={6} fill="var(--chart-1)" stroke="var(--card)" strokeWidth={2} />
              <text
                x={cx + (right ? 10 : -10)}
                y={cy}
                dy="0.32em"
                textAnchor={right ? "start" : "end"}
                className="fill-foreground text-[10px] font-medium"
              >
                {p.sku}
              </text>
              <circle
                cx={cx}
                cy={cy}
                r={14}
                fill="transparent"
                tabIndex={0}
                aria-label={`${p.sku}: porsi ${pct(p.share, 1)}, pertumbuhan ${signed(p.growth)}, ${p.quadrantLabel}`}
                className="cursor-pointer outline-none"
                onPointerEnter={(e) => show(e.currentTarget, content)}
                onFocus={(e) => show(e.currentTarget, content)}
                onBlur={hide}
              />
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}
