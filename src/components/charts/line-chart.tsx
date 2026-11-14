"use client";

import { useEffect, useRef, useState } from "react";
import { formatIDR } from "@/lib/format";
import { niceTicks, shortDate } from "./chart-utils";

export type LineSeries = {
  key: string;
  label: string;
  color: string;
  /** One value per x; null = no data (a gap, never zero). */
  values: (number | null)[];
  /** Reference series (e.g. target pace): thinner, no end-dot. */
  reference?: boolean;
};

const H = 240;
const M = { top: 12, right: 92, bottom: 26, left: 64 };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Last index with a value, or -1. */
const lastIndex = (v: (number | null)[]) => {
  for (let i = v.length - 1; i >= 0; i--) if (v[i] !== null) return i;
  return -1;
};

/** Path with gaps at nulls. */
function linePath(values: (number | null)[], x: (i: number) => number, y: (v: number) => number) {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/**
 * Line chart over daily dates (IDR values) with a crosshair tooltip and
 * direct end labels. One y-axis only.
 */
export function LineChart({
  dates,
  series,
  ariaLabel,
  endLabels = true,
}: {
  dates: string[];
  series: LineSeries[];
  ariaLabel: string;
  endLabels?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const right = endLabels && width >= 420 ? M.right : 12;
  const iw = width - M.left - right;
  const ih = H - M.top - M.bottom;
  const max = Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const x = (i: number) => M.left + (dates.length <= 1 ? 0 : (i / (dates.length - 1)) * iw);
  const y = (v: number) => M.top + ih - (v / top) * ih;

  const xTickCount = Math.max(2, Math.min(7, Math.floor(iw / 80)));
  const xTicks = Array.from({ length: xTickCount }, (_, k) => Math.round((k / (xTickCount - 1)) * (dates.length - 1)));

  // End labels: one per non-reference series, nudged apart only by a leader if needed.
  const ends = series
    .map((s) => ({ s, i: lastIndex(s.values) }))
    .filter((e) => e.i >= 0)
    .map((e) => ({ ...e, y: y(e.s.values[e.i]!) }))
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14;

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const i = Math.round((px / box.width) * (dates.length - 1));
    setHover(Math.max(0, Math.min(dates.length - 1, i)));
  }

  const tipLeft = hover === null ? 0 : x(hover);
  const tipRows = hover === null ? [] : series.filter((s) => s.values[hover] !== undefined);

  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-x-clip select-none">
      <svg width={width} height={H} role="img" aria-label={ariaLabel} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={M.left + iw}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? "var(--chart-axis)" : "var(--chart-grid)"}
              strokeWidth={1}
            />
            <text
              x={M.left - 8}
              y={y(t)}
              dy="0.32em"
              textAnchor="end"
              className="fill-muted-foreground text-[11px] tabular-nums"
            >
              {t === 0 ? "0" : formatIDR(t, { compact: true })}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === dates.length - 1 ? "end" : "middle"}
            className="fill-muted-foreground text-[11px]"
          >
            {shortDate(dates[i])}
          </text>
        ))}
        {series.map((s) => (
          <path
            key={s.key}
            d={linePath(s.values, x, y)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.reference ? 1.5 : 2}
            strokeOpacity={s.reference ? 0.9 : 1}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {series
          .filter((s) => !s.reference)
          .map((s) => {
            const i = lastIndex(s.values);
            return i < 0 ? null : (
              <circle
                key={s.key}
                cx={x(i)}
                cy={y(s.values[i]!)}
                r={4}
                fill={s.color}
                stroke="var(--card)"
                strokeWidth={2}
              />
            );
          })}
        {endLabels && right === M.right
          ? ends.map((e) => (
              <g key={e.s.key}>
                {Math.abs(e.y - y(e.s.values[e.i]!)) > 2 ? (
                  <line
                    x1={x(e.i) + 6}
                    x2={M.left + iw + 6}
                    y1={y(e.s.values[e.i]!)}
                    y2={e.y}
                    stroke="var(--chart-axis)"
                    strokeWidth={1}
                  />
                ) : null}
                <text x={M.left + iw + 8} y={e.y} dy="0.32em" className="fill-foreground text-[11px]">
                  {e.s.label}
                </text>
              </g>
            ))
          : null}
        {hover !== null ? (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} stroke="var(--chart-axis)" strokeWidth={1} />
            {series.map((s) =>
              s.values[hover] === null ? null : (
                <circle
                  key={s.key}
                  cx={x(hover)}
                  cy={y(s.values[hover]!)}
                  r={4}
                  fill={s.color}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              ),
            )}
          </g>
        ) : null}
        <rect
          x={M.left}
          y={M.top}
          width={iw}
          height={ih}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-1 z-10 min-w-40 rounded-md border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
          style={tipLeft > width / 2 ? { right: width - tipLeft + 10 } : { left: tipLeft + 10 }}
        >
          <p className="mb-1 font-medium">{shortDate(dates[hover])}</p>
          <ul className="space-y-0.5">
            {tipRows.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="ml-auto pl-3 font-medium tabular-nums">
                  {s.values[hover] === null
                    ? "tidak ada data"
                    : formatIDR(Math.round(s.values[hover]!), { compact: true })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
