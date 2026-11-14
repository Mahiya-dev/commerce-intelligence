import type { EcommerceOverview } from "@/lib/data/ecommerce";
import { formatIDR, formatPercent } from "@/lib/format";
import { TARGET_STATUS_LABEL, TargetStatusBadge } from "@/components/shared/target-status-badge";
import { ChartCard } from "@/components/charts/chart-card";
import { LineChart } from "@/components/charts/line-chart";
import { channelColor, monthLabel, shortDate } from "@/components/charts/chart-utils";

type Overview = Extract<EcommerceOverview, { status: "ok" }>;

const idr = (v: number | null | undefined) =>
  formatIDR(v === null || v === undefined ? null : Math.round(v), { compact: true });

/** Tooltip shown on hover and keyboard focus of a bar row (CSS only, no client JS). */
function Tip({ lines }: { lines: string[] }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-0 z-10 mb-1 hidden min-w-44 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md group-hover:block group-focus-visible:block"
    >
      {lines.map((l, i) => (
        <span key={i} className={`block ${i === 0 ? "font-medium" : "text-muted-foreground"}`}>
          {l}
        </span>
      ))}
    </span>
  );
}

/** Cumulative GMV this month vs the straight-line target pace. */
function CumulativeChart({ o }: { o: Overview }) {
  const c = o.charts.cumulative;
  if (!c) {
    return (
      <ChartCard title="GMV kumulatif vs target" description="Target bulan ini belum diimpor.">
        <p className="py-10 text-center text-sm text-muted-foreground">
          Impor target bulanan untuk melihat jalur target.
        </p>
      </ChartCard>
    );
  }
  const name = (code: string) => o.channels.find((ch) => ch.code === code)?.name ?? code;
  const without = o.targets.channelsWithoutTarget;
  const t = o.targets.all;
  return (
    <ChartCard
      title="GMV kumulatif vs jalur target"
      description={`${monthLabel(o.month)} s.d. ${shortDate(o.asOf)}${t ? ` · ${formatPercent(t.progress)} dari jalur (${TARGET_STATUS_LABEL[t.status!]})` : ""}${
        without.length ? ` · tanpa ${without.map(name).join(", ")} (belum ada target)` : ""
      }`}
      legend={[
        { label: "GMV kumulatif", color: "var(--primary)", kind: "line" },
        { label: "Jalur target (linear)", color: "var(--chart-pace)", kind: "line" },
      ]}
      table={{
        caption: "GMV kumulatif harian dan jalur target",
        head: ["Tanggal", "GMV kumulatif", "Jalur target"],
        rows: c.map((p) => [shortDate(p.date), idr(p.actual), idr(p.pace)]),
      }}
    >
      <LineChart
        ariaLabel="GMV kumulatif bulan ini dibandingkan jalur target"
        endLabels={false}
        dates={c.map((p) => p.date)}
        series={[
          {
            key: "pace",
            label: "Jalur target",
            color: "var(--chart-pace)",
            values: c.map((p) => p.pace),
            reference: true,
          },
          { key: "actual", label: "Aktual", color: "var(--primary)", values: c.map((p) => p.actual) },
        ]}
      />
    </ChartCard>
  );
}

/** Daily GMV per channel, previous month to the as-of date. */
function DailyChart({ o }: { o: Overview }) {
  const series = o.charts.daily;
  const dates = series[0]?.points.map((p) => p.date) ?? [];
  const name = (code: string) => o.channels.find((ch) => ch.code === code)?.name ?? code;
  return (
    <ChartCard
      title="GMV harian per channel"
      description={`${shortDate(dates[0])} – ${shortDate(o.asOf)} · hari tanpa laporan tampil sebagai celah, bukan nol`}
      legend={series.map((s) => ({ label: name(s.channel), color: channelColor(s.channel), kind: "line" as const }))}
      table={{
        caption: "GMV harian per channel",
        head: ["Tanggal", ...series.map((s) => name(s.channel))],
        rows: dates.map((d, i) => [shortDate(d), ...series.map((s) => idr(s.points[i].value))]),
      }}
    >
      <LineChart
        ariaLabel="GMV harian per channel"
        dates={dates}
        series={series.map((s) => ({
          key: s.channel,
          label: name(s.channel),
          color: channelColor(s.channel),
          values: s.points.map((p) => p.value),
        }))}
      />
    </ChartCard>
  );
}

/** Bullet rows: actual MTD bar, expected-to-date tick, full-month target as the track. */
function TargetBullets({ o }: { o: Overview }) {
  const rows = o.targets.rows.map((r) => ({
    ...r,
    name: o.channels.find((c) => c.code === r.channel)?.name ?? r.channel,
  }));
  return (
    <ChartCard
      title="Progres target per channel"
      description="Batang = GMV MTD · garis tegak = posisi seharusnya hari ini · lintasan penuh = target sebulan"
      legend={[{ label: "Seharusnya hari ini (jalur target)", color: "var(--foreground)", kind: "tick" }]}
      table={{
        caption: "Progres target per channel",
        head: ["Channel", "GMV MTD", "Seharusnya", "Target", "Progres", "Status"],
        rows: rows.map((r) => [
          r.name,
          idr(r.result?.actual),
          idr(r.result?.expected),
          idr(r.result?.target),
          formatPercent(r.result?.progress ?? null),
          r.result?.status ? TARGET_STATUS_LABEL[r.result.status] : "—",
        ]),
      }}
    >
      <ul className="space-y-4 py-1">
        {rows.map((r) => {
          const res = r.result;
          const scale = res ? Math.max(res.target, res.actual) : 1;
          return (
            <li key={r.channel} className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <span
                    aria-hidden
                    className="size-2.5 rounded-[3px]"
                    style={{ background: channelColor(r.channel) }}
                  />
                  {r.name}
                </span>
                {res ? (
                  <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                    {formatPercent(res.progress)} dari jalur <TargetStatusBadge status={res.status} />
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Belum ada target</span>
                )}
              </div>
              {res ? (
                <div
                  tabIndex={0}
                  aria-label={`${r.name}: GMV ${idr(res.actual)}, seharusnya ${idr(res.expected)}, target ${idr(res.target)}`}
                  className="group relative h-4 rounded-[4px] bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-r-[4px]"
                    style={{ width: `${(res.actual / scale) * 100}%`, background: channelColor(r.channel) }}
                  />
                  <div
                    aria-hidden
                    className="absolute -inset-y-1 w-0.5 rounded-full bg-foreground"
                    style={{ left: `calc(${(res.expected / scale) * 100}% - 1px)` }}
                  />
                  <Tip
                    lines={[
                      r.name,
                      `GMV MTD ${idr(res.actual)}`,
                      `Seharusnya ${idr(res.expected)} · target ${idr(res.target)}`,
                      `Perlu ${idr(res.runRateNeeded)}/hari · forecast ${idr(res.forecast)}`,
                    ]}
                  />
                </div>
              ) : (
                <div className="h-4 rounded-[4px] bg-muted" />
              )}
              {res ? (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {idr(res.actual)} dari {idr(res.target)} · perlu {idr(res.runRateNeeded)}/hari
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}

/** Channel mix per month: one tall segmented bar per month, length ∝ month total. */
function ChannelMix({ o }: { o: Overview }) {
  const max = Math.max(1, ...o.months.map((m) => m.all.gmv));
  const name = (code: string) => o.channels.find((c) => c.code === code)?.name ?? code;
  return (
    <ChartCard
      title="Komposisi GMV per channel per bulan"
      description="Panjang batang = total GMV bulan itu · persentase = porsi channel"
      legend={o.channels.map((c) => ({ label: c.name, color: channelColor(c.code) }))}
      table={{
        caption: "GMV per channel per bulan",
        head: ["Bulan", ...o.channels.map((c) => c.name), "Total"],
        rows: o.months.map((m) => [
          `${monthLabel(m.month)}${m.isPartial ? " (MTD)" : ""}`,
          ...m.rows.map((r) => idr(r.totals.gmv)),
          idr(m.all.gmv),
        ]),
      }}
    >
      <ul className="space-y-3 py-1">
        {o.months.map((m) => (
          <li key={m.month} className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {monthLabel(m.month)}
              {m.isPartial ? <span className="block">s.d. {shortDate(m.to)}</span> : null}
            </span>
            <div className="flex items-center gap-2">
              <div className="flex h-7 gap-0.5" style={{ width: `calc((100% - 5.5rem) * ${m.all.gmv / max})` }}>
                {m.rows
                  .filter((r) => r.totals.gmv > 0)
                  .map((r) => {
                    const share = r.totals.gmv / m.all.gmv;
                    return (
                      <div
                        key={r.channel}
                        tabIndex={0}
                        aria-label={`${monthLabel(m.month)} ${name(r.channel)}: ${idr(r.totals.gmv)}, ${formatPercent(share)}`}
                        className="group relative flex items-center rounded-[4px] px-1.5 text-[11px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        style={{ flexGrow: r.totals.gmv, flexBasis: 0, background: channelColor(r.channel) }}
                      >
                        <span className="truncate">{share >= 0.12 ? formatPercent(share, 0) : ""}</span>
                        <Tip lines={[name(r.channel), idr(r.totals.gmv), `${formatPercent(share)} dari bulan ini`]} />
                      </div>
                    );
                  })}
              </div>
              <span className="shrink-0 text-xs font-medium tabular-nums">{idr(m.all.gmv)}</span>
            </div>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

/** Top SKUs by listing GMV this month; unmapped listings shown as their own gray row. */
function SkuBars({ o }: { o: Overview }) {
  const total = o.skuCoverage.listingGmv;
  const mapped = o.skus.filter((s) => s.sku).slice(0, 8);
  const unmapped = o.skus.find((s) => !s.sku);
  const rows = [
    ...mapped.map((s) => ({ key: s.sku!, label: s.name ?? s.sku!, sub: s.sku!, gmv: s.gmv, color: "var(--primary)" })),
    ...(unmapped
      ? [
          {
            key: "_unmapped",
            label: "Listing belum dipetakan",
            sub: "perlu dipetakan ke SKU",
            gmv: unmapped.gmv,
            color: "var(--chart-other)",
          },
        ]
      : []),
  ];
  const max = Math.max(1, ...rows.map((r) => r.gmv));
  return (
    <ChartCard
      title="Kontribusi SKU (GMV listing)"
      description={`${monthLabel(o.month)} s.d. ${shortDate(o.asOf)} · dari laporan produk`}
      table={{
        caption: "GMV per SKU bulan ini",
        head: ["SKU", "GMV", "Porsi"],
        rows: rows.map((r) => [r.label, idr(r.gmv), formatPercent(total ? r.gmv / total : null)]),
      }}
    >
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Belum ada laporan produk bulan ini.</p>
      ) : (
        <ul className="space-y-2.5 py-1">
          {rows.map((r) => (
            <li key={r.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 truncate font-medium" title={r.sub}>
                  {r.label}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {idr(r.gmv)} · {formatPercent(total ? r.gmv / total : null)}
                </span>
              </div>
              <div
                tabIndex={0}
                aria-label={`${r.label}: ${idr(r.gmv)}`}
                className="group relative h-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div
                  className="h-full rounded-r-[4px]"
                  style={{ width: `${(r.gmv / max) * 100}%`, background: r.color }}
                />
                <Tip
                  lines={[
                    r.label,
                    r.sub,
                    `${idr(r.gmv)} · ${formatPercent(total ? r.gmv / total : null)} dari GMV listing`,
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

export function SalesCharts({ overview }: { overview: Overview }) {
  return (
    <section aria-labelledby="charts-heading" className="space-y-3">
      <h2 id="charts-heading" className="text-sm font-semibold">
        Grafik penjualan
      </h2>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <CumulativeChart o={overview} />
        <TargetBullets o={overview} />
        <div className="min-w-0 xl:col-span-2">
          <DailyChart o={overview} />
        </div>
        <ChannelMix o={overview} />
        <SkuBars o={overview} />
      </div>
    </section>
  );
}
