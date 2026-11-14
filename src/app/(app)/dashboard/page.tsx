import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  Link2,
  MousePointerClick,
  PackageSearch,
  ShoppingCart,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { DEFAULT_KPI_SETTINGS } from "@/lib/organization/settings";
import { requireRole } from "@/lib/auth/guards";
import { getMasterDataSummary } from "@/lib/data/master-data";
import { CURRENT_PHASE, NAVIGATION } from "@/config/navigation";
import { getEcommerceOverview, getSalesForRange } from "@/lib/data/ecommerce";
import { RANGE_PRESET_LABELS } from "@/lib/ecommerce/date-range";
import { formatDate, formatIDR, formatNumber, formatPercent, MISSING } from "@/lib/format";
import { ChangeText, formatChange, TARGET_STATUS_LABEL } from "@/components/shared/target-status-badge";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import { getDashboardInsight } from "@/lib/ai/insights";
import { AiInsightSection } from "./ai-insight-section";
import { SalesCharts } from "./sales-charts";
import { PageHeader } from "@/components/shared/page-header";
import { DemoNotice } from "@/components/shared/demo-badge";
import { DataSourceLabel } from "@/components/shared/data-source-label";
import { KpiCard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Dashboard" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

const period = (from: string, to: string) =>
  from === to ? formatDate(from, "UTC") : `${formatDate(from, "UTC")} – ${formatDate(to, "UTC")}`;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const below = (value: number | null, target: number | null) => value !== null && target !== null && value < target;
/** " · target X (di bawah)" — empty when no target is set. */
const benchmark = (value: number | null, target: number | null, fmt: (v: number) => string) =>
  target === null ? "" : ` · target ${fmt(target)}${below(value, target) ? " (di bawah)" : ""}`;

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const session = await requireRole("viewer");
  const { organization } = session;
  const sp = await searchParams;
  const rangeInput = { range: first(sp.range), from: first(sp.from), to: first(sp.to) };
  const [summary, sales, ranged] = await Promise.all([
    getMasterDataSummary(session),
    getEcommerceOverview(session),
    getSalesForRange(session, rangeInput),
  ]);
  const ok = sales.status === "ok" ? sales : null;
  const r = ranged.status === "ok" ? ranged : null;
  const vs = r ? `vs ${period(r.range.compare.from, r.range.compare.to)}` : "";
  const insightView = await getDashboardInsight(session, sales);
  const insightParam = sp.insight;
  const target = ok?.targets.all ?? null;
  const kpi = r?.kpi ?? DEFAULT_KPI_SETTINGS;

  const modules = NAVIGATION.flatMap((s) => s.items).filter((i) => i.href !== "/dashboard");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Ringkasan kinerja lintas channel dan modul. Metrik penjualan berasal dari laporan marketplace yang sudah disimpan."
        isDemo={organization.isDemo}
      />
      {organization.isDemo ? <DemoNotice /> : null}

      <section aria-labelledby="kpi-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 id="kpi-heading" className="text-sm font-semibold">
              KPI E-Commerce ·{" "}
              {r ? `${RANGE_PRESET_LABELS[r.range.preset]}: ${period(r.range.from, r.range.to)}` : "Bulan berjalan"}
            </h2>
            <DataSourceLabel
              source={r ? "Laporan marketplace" : "Laporan marketplace (belum diimpor)"}
              updatedAt={r?.lastImportAt ?? null}
              timeZone={organization.timezone}
            />
          </div>
          {r ? (
            <DateRangeFilter
              key={`${r.range.preset}|${r.range.from}|${r.range.to}`}
              action="/dashboard"
              preset={r.range.preset}
              from={r.range.from}
              to={r.range.to}
              min={r.dataFrom}
              max={r.asOf}
            />
          ) : null}
        </div>
        {r?.range.error ? <p className="text-xs text-destructive">{r.range.error}</p> : null}
        {r?.range.clippedTo ? (
          <p className="text-xs text-muted-foreground">
            Rentang dipotong s.d. {formatDate(r.range.clippedTo, "UTC")} (data terakhir) agar perbandingan setara.
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <KpiCard
            label="GMV"
            value={r ? formatIDR(r.current.gmv, { compact: true }) : null}
            hint={r ? `${formatChange(r.gmvChange)} ${vs}` : "Belum ada data penjualan"}
            icon={Wallet}
          />
          <KpiCard
            label="Orders"
            value={r ? formatNumber(r.current.orders) : null}
            hint={r ? `${formatChange(r.ordersChange)} ${vs}` : "Belum ada data penjualan"}
            icon={ShoppingCart}
          />
          <KpiCard
            label="AOV"
            value={r ? formatIDR(r.current.aov === null ? null : Math.round(r.current.aov)) : null}
            hint={
              r
                ? `${formatChange(r.aovChange)} ${vs}${benchmark(r.current.aov, kpi.targetAov, formatIDR)}`
                : "Belum ada data penjualan"
            }
            hintTone={r && below(r.current.aov, kpi.targetAov) ? "warning" : undefined}
            icon={TrendingUp}
          />
          <KpiCard
            label="Conversion rate"
            value={r ? formatPercent(r.current.conversionRate, 2) : null}
            hint={
              r
                ? `${formatChange(r.conversionChange)} ${vs}${benchmark(r.current.conversionRate, kpi.targetConversionRate, (v) => formatPercent(v, 2))}`
                : "Belum ada data penjualan"
            }
            hintTone={r && below(r.current.conversionRate, kpi.targetConversionRate) ? "warning" : undefined}
            icon={MousePointerClick}
          />
          <KpiCard
            label={ok ? `Target ${monthLabel(ok.month)}` : "Pencapaian Target"}
            value={target ? formatPercent(target.progress) : null}
            hint={
              target?.status
                ? `${TARGET_STATUS_LABEL[target.status]} · forecast ${formatIDR(Math.round(target.forecast), { compact: true })}`
                : ok
                  ? "Target bulan ini belum diimpor"
                  : "Target belum ditetapkan"
            }
            icon={Target}
          />
        </div>
        {r ? (
          <Card className="py-0">
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead className="text-right">GMV</TableHead>
                    <TableHead className="text-right">Δ GMV</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">AOV</TableHead>
                    <TableHead className="text-right">Conversion</TableHead>
                    <TableHead className="text-right">Hari data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.channels.map((c) => (
                    <TableRow key={c.code}>
                      <TableCell>{c.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.current.days ? formatIDR(c.current.gmv, { compact: true }) : MISSING}
                      </TableCell>
                      <TableCell className="text-right">
                        <ChangeText value={c.gmvChange} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.current.days ? formatNumber(c.current.orders) : MISSING}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatIDR(c.current.aov === null ? null : Math.round(c.current.aov))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPercent(c.current.conversionRate, 2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.current.days} / {r.range.days}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}
        {r?.incomplete.length ? (
          <p className="text-xs text-warning-foreground">
            Data belum lengkap pada rentang ini:{" "}
            {r.incomplete.map((c) => `${c.name} kurang ${c.missingDays} hari`).join(", ")}.
          </p>
        ) : null}
      </section>

      {ok ? <SalesCharts overview={ok} /> : null}

      <AiInsightSection
        view={insightView}
        outcome={typeof insightParam === "string" ? insightParam : undefined}
        timeZone={organization.timezone}
      />

      <section aria-labelledby="master-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="master-heading" className="text-sm font-semibold">
            Kesiapan master data
          </h2>
          <DataSourceLabel
            source={organization.isDemo ? "Seed DEMO" : "Master produk"}
            updatedAt={summary.lastMasterDataUpdate}
            timeZone={organization.timezone}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Produk" value={formatNumber(summary.products)} icon={Boxes} />
          <KpiCard label="Varian SKU" value={formatNumber(summary.variants)} icon={PackageSearch} />
          <KpiCard label="Channel listing" value={formatNumber(summary.listings)} icon={Link2} />
          <KpiCard
            label="Listing belum dipetakan"
            value={formatNumber(summary.unmappedListings)}
            hint={summary.unmappedListings > 0 ? "Perlu dipetakan sebelum analisis SKU" : "Semua listing terpetakan"}
            icon={Users}
          />
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Status modul</CardTitle>
          <CardDescription>Rencana pengiriman bertahap. Modul aktif setelah fase terkait disetujui.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {modules.map((m) => (
              <li key={m.href} className="flex items-center gap-3 py-2.5">
                <m.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Link href={m.href} className="text-sm font-medium hover:underline">
                  {m.title}
                </Link>
                <span className="hidden truncate text-xs text-muted-foreground md:inline">{m.description}</span>
                <span className="ml-auto shrink-0">
                  {m.phase <= CURRENT_PHASE ? (
                    <Badge variant="success">Aktif</Badge>
                  ) : (
                    <Badge variant="outline">Fase {m.phase}</Badge>
                  )}
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
