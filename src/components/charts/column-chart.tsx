"use client";

import { ChartFrame, ChartTooltip, columnPath, niceTicks, rupiahCompact, useChartTooltip } from "./chart-tooltip";

export type ColumnDatum = {
  key: string;
  label: string;
  value: number | null;
  /** Partial period (e.g. month-to-date): drawn as a wash, labelled "MTD". */
  partial?: boolean;
  /** Extra tooltip rows. */
  details?: { label: string; value: string }[];
};

const W = 640;
const H = 220;
const PAD = { top: 16, right: 8, bottom: 28, left: 56 };

/**
 * Single-series column chart (one hue, so no legend — the card title names it).
 * Null values are gaps ("no data"), never zero-height bars.
 */
export function ColumnChart({
  data,
  label,
  valueLabel = "GMV",
}: {
  data: ColumnDatum[];
  label: string;
  /** Name of the plotted measure in the tooltip (rupiah). */
  valueLabel?: string;
}) {
  const { containerRef, tip, show, hide } = useChartTooltip();
  const max = Math.max(0, ...data.map((d) => d.value ?? 0));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / Math.max(data.length, 1);
  const barW = Math.min(24, band * 0.6);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const peak = data.reduce<ColumnDatum | null>(
    (m, d) => (d.value !== null && (!m || d.value > (m.value ?? 0)) ? d : m),
    null,
  );
  const last = [...data].reverse().find((d) => d.value !== null);

  return (
    <ChartFrame containerRef={containerRef} label={label} tooltip={<ChartTooltip tip={tip} />}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" onPointerLeave={hide}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px]">
              {rupiahCompact(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.left + band * i + band / 2;
          const x = cx - barW / 2;
          const labelled = d === last || d === peak;
          const content = {
            title: d.partial ? `${d.label} (MTD)` : d.label,
            rows: [{ label: valueLabel, value: d.value === null ? "—" : rupiahCompact(d.value) }, ...(d.details ?? [])],
          };
          return (
            <g key={d.key}>
              {d.value !== null && d.value > 0 ? (
                <path
                  d={columnPath(x, y(d.value), barW, y(0) - y(d.value))}
                  fill="var(--chart-1)"
                  fillOpacity={d.partial ? 0.35 : 1}
                  stroke={d.partial ? "var(--chart-1)" : undefined}
                  strokeWidth={d.partial ? 1 : undefined}
                />
              ) : null}
              {labelled && d.value !== null ? (
                <text x={cx} y={y(d.value) - 5} textAnchor="middle" className="fill-foreground text-[10px] font-medium">
                  {rupiahCompact(d.value)}
                </text>
              ) : null}
              <text x={cx} y={H - 10} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {d.label}
                {d.partial ? "*" : ""}
              </text>
              {/* Hit target: the whole band, bigger than the mark. */}
              <rect
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${content.title}: ${content.rows[0].value}`}
                className="outline-none focus-visible:stroke-ring"
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
