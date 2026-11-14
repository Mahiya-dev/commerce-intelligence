"use client";

import { ChartFrame, ChartTooltip, columnPath, niceTicks, rupiahCompact, useChartTooltip } from "./chart-tooltip";

export type StackSeries = { key: string; label: string; color: string };
export type StackDatum = { key: string; label: string; partial?: boolean; values: Record<string, number> };

const W = 640;
const H = 240;
const PAD = { top: 16, right: 8, bottom: 28, left: 56 };
const GAP = 2; // surface gap between stacked segments

/**
 * Stacked columns (≤ 5 categorical series in fixed palette order). Legend is
 * always shown; the page also renders the values as a table.
 */
export function StackedColumns({ data, series, label }: { data: StackDatum[]; series: StackSeries[]; label: string }) {
  const { containerRef, tip, show, hide } = useChartTooltip();
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] ?? 0), 0));
  const ticks = niceTicks(Math.max(0, ...totals));
  const top = ticks[ticks.length - 1];
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / Math.max(data.length, 1);
  const barW = Math.min(24, band * 0.6);
  const scale = (v: number) => (v / top) * plotH;

  return (
    <div className="grid gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-[2px]" style={{ background: s.color }} aria-hidden />
            {s.label}
          </li>
        ))}
      </ul>
      <ChartFrame containerRef={containerRef} label={label} tooltip={<ChartTooltip tip={tip} />}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" onPointerLeave={hide}>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={PAD.top + plotH - scale(t)}
                y2={PAD.top + plotH - scale(t)}
                stroke="var(--chart-grid)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={PAD.top + plotH - scale(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {rupiahCompact(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            const x = cx - barW / 2;
            const present = series.filter((s) => (d.values[s.key] ?? 0) > 0);
            let base = PAD.top + plotH;
            const content = {
              title: d.partial ? `${d.label} (MTD)` : d.label,
              rows: [
                { label: "Total", value: rupiahCompact(totals[i]) },
                ...present.map((s) => ({
                  key: s.key,
                  color: s.color,
                  label: s.label,
                  value: rupiahCompact(d.values[s.key]),
                })),
              ],
            };
            return (
              <g key={d.key} opacity={d.partial ? 0.55 : 1}>
                {present.map((s, j) => {
                  const h = scale(d.values[s.key]);
                  const isTop = j === present.length - 1;
                  const segH = Math.max(0, h - (isTop ? 0 : GAP));
                  base -= h;
                  return isTop ? (
                    <path key={s.key} d={columnPath(x, base, barW, segH)} fill={s.color} />
                  ) : (
                    <rect key={s.key} x={x} y={base + GAP} width={barW} height={segH} fill={s.color} />
                  );
                })}
                <text x={cx} y={H - 10} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                  {d.label}
                  {d.partial ? "*" : ""}
                </text>
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${content.title}: total ${content.rows[0].value}`}
                  className="outline-none"
                  onPointerEnter={(e) => show(e.currentTarget, content)}
                  onFocus={(e) => show(e.currentTarget, content)}
                  onBlur={hide}
                />
              </g>
            );
          })}
        </svg>
      </ChartFrame>
    </div>
  );
}
