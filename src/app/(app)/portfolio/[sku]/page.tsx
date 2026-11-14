import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Info,
  Lightbulb,
  MousePointerClick,
  Package,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { getProductDetail } from "@/lib/data/portfolio";
import { formatIDR, formatNumber, MISSING, monthName } from "@/lib/format";
import { TOUCHPOINT_LABELS, TOUCHPOINTS } from "@/lib/imports/templates";
import { QUADRANT_DESCRIPTIONS, type Recommendation } from "@/lib/portfolio/portfolio";
import { PageHeader } from "@/components/shared/page-header";
import { DemoNotice } from "@/components/shared/demo-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { MonthSelect } from "@/components/shared/month-select";
import { QuadrantBadge } from "@/components/shared/quadrant-badge";
import { ColumnChart } from "@/components/charts/column-chart";
import { StackedColumns } from "@/components/charts/stacked-columns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Detail Produk" };

const NUM = "text-right tabular-nums";
const pct = (v: number | null, digits = 1) =>
  v === null || !Number.isFinite(v)
    ? MISSING
    : new Intl.NumberFormat("id-ID", {
        style: "percent",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(v);
const signed = (v: number | null) => (v === null ? MISSING : `${v > 0 ? "+" : v < 0 ? "−" : ""}${pct(Math.abs(v))}`);
const roas = (v: number | null) =>
  v === null
    ? MISSING
    : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(v);
const shortMonth = (ym: string) => `${monthName(ym).slice(0, 3)} ${ym.slice(2, 4)}`;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Fixed categorical order (validated palette slots 1–5). */
const TP_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const PRIORITY: Record<Recommendation["priority"], { label: string; variant: "destructive" | "warning" | "outline" }> =
  {
    tinggi: { label: "Prioritas tinggi", variant: "destructive" },
    sedang: { label: "Sedang", variant: "warning" },
    info: { label: "Info", variant: "outline" },
  };

export default async function ProductDetailPage({ params, searchParams }: PageProps<"/portfolio/[sku]">) {
  const item = requireNavItem("/portfolio");
  const session = await requireRole(item.minRole);
  const { organization } = session;
  const { sku: rawSku } = await params;
  const sku = decodeURIComponent(rawSku);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(sku)) notFound();
  const sp = await searchParams;
  const data = await getProductDetail(session, sku, { month: first(sp.month) });
  if (data.status === "not_found") notFound();

  const back = (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/portfolio${first(sp.month) ? `?month=${first(sp.month)}` : ""}`}>
          <ArrowLeft aria-hidden /> Portofolio Produk
        </Link>
      </Button>
    </div>
  );
  const title = `${data.info.name}`;
  const description = `${data.info.sku} · ${data.info.productName}${data.info.productType === "bundle" ? " · bundle" : ""}`;

  if (data.status === "empty") {
    return (
      <div className="space-y-6">
        {back}
        <PageHeader title={title} description={description} isDemo={organization.isDemo} />
        <EmptyState
          icon={Package}
          title="Belum ada penjualan untuk SKU ini"
          description="Pastikan listing marketplace sudah dipetakan ke SKU ini lewat Master Listing, lalu impor Kinerja Produk Harian."
        />
      </div>
    );
  }

  const { row, trend, touchpoints, recommendations } = data;
  const asOfMonth = data.asOf.slice(0, 7);
  const usedTouchpoints = TOUCHPOINTS.filter((tp) => data.touchpointTrend.some((m) => (m.byTouchpoint[tp] ?? 0) > 0));
  const monthIdx = data.trend.findIndex((t) => t.month === data.month);
  const prevQuadrant = monthIdx > 0 ? data.quadrants[monthIdx - 1] : null;

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        title={title}
        description={description}
        isDemo={organization.isDemo}
        actions={row ? <QuadrantBadge quadrant={row.quadrant} /> : null}
      />
      {organization.isDemo ? <DemoNotice /> : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm">
          <span className="font-medium">{monthName(data.month)}</span>
          {data.month === asOfMonth ? ` (MTD s.d. ${data.asOf.slice(8)})` : ""} · dibandingkan{" "}
          {data.compare.from.slice(8)}–{data.compare.to.slice(8)} {monthName(data.compare.from.slice(0, 7))}
          {row ? <span className="text-muted-foreground"> · {QUADRANT_DESCRIPTIONS[row.quadrant]}</span> : null}
        </p>
        <MonthSelect
          action={`/portfolio/${encodeURIComponent(sku)}`}
          months={data.months}
          value={data.month}
          partialMonth={asOfMonth}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="GMV"
          value={row ? formatIDR(row.current.gmv, { compact: true }) : null}
          hint={row ? `${signed(row.growth)} · porsi ${pct(row.share)}` : "Tidak ada penjualan bulan ini"}
          icon={Wallet}
        />
        <KpiCard
          label="Pesanan · Unit"
          value={row ? `${formatNumber(row.current.orders)} · ${formatNumber(row.current.units)}` : null}
          hint="Unit = unit SKU (unit listing × isi per listing)"
          icon={ShoppingCart}
        />
        <KpiCard
          label="AOV"
          value={row ? formatIDR(row.current.aov === null ? null : Math.round(row.current.aov)) : null}
          hint={
            row
              ? `Bulan sebelumnya ${formatIDR(row.previous.aov === null ? null : Math.round(row.previous.aov))}`
              : undefined
          }
          icon={TrendingUp}
        />
        <KpiCard
          label="Conversion rate"
          value={row ? pct(row.current.conversionRate, 2) : null}
          hint={row ? `${formatNumber(row.current.clicks)} klik produk` : undefined}
          icon={MousePointerClick}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Lightbulb className="size-4" aria-hidden /> Rekomendasi · {monthName(data.month)}
          </CardTitle>
          <CardDescription>
            Berdasarkan aturan kuadran dan kinerja touchpoint; setiap rekomendasi menyebut angka yang mendasarinya.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recommendations.length ? (
            <ul className="grid gap-3">
              {recommendations.map((r, i) => (
                <li key={i} className="grid gap-1 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.priority === "tinggi" ? (
                      <AlertTriangle className="size-4 text-destructive" aria-hidden />
                    ) : (
                      <Info className="size-4 text-muted-foreground" aria-hidden />
                    )}
                    <span className="text-sm font-medium">{r.title}</span>
                    <Badge variant={PRIORITY[r.priority].variant}>{PRIORITY[r.priority].label}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{r.detail}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Tidak ada penjualan pada bulan ini.</p>
          )}
          {prevQuadrant && row && prevQuadrant !== row.quadrant ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Kuadran bulan sebelumnya: <QuadrantBadge quadrant={prevQuadrant} />
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">GMV bulanan · 12 bulan</CardTitle>
          <CardDescription>* bulan berjalan (MTD), ditampilkan transparan karena belum penuh.</CardDescription>
        </CardHeader>
        <CardContent>
          <ColumnChart
            label={`GMV bulanan ${data.info.sku}`}
            data={trend.map((t) => ({
              key: t.month,
              label: shortMonth(t.month),
              value: t.gmv > 0 ? t.gmv : null,
              partial: t.isPartial,
              details: [
                { label: "Pesanan", value: formatNumber(t.orders) },
                { label: "AOV", value: formatIDR(t.aov === null ? null : Math.round(t.aov)) },
              ],
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Touchpoint · {monthName(data.month)}</CardTitle>
          <CardDescription>
            ROAS = GMV ÷ biaya (iklan: belanja iklan, afiliasi: komisi, live: biaya host/produksi). Organik dan video
            tidak melaporkan biaya.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {touchpoints.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Touchpoint</TableHead>
                  <TableHead className="text-right">GMV</TableHead>
                  <TableHead className="text-right">Porsi</TableHead>
                  <TableHead className="text-right">Pertumbuhan</TableHead>
                  <TableHead className="text-right">Pesanan</TableHead>
                  <TableHead className="text-right">Biaya</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {touchpoints.map((t) => (
                  <TableRow key={t.touchpoint}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block size-2.5 rounded-[2px]"
                          style={{ background: TP_COLORS[TOUCHPOINTS.indexOf(t.touchpoint)] }}
                          aria-hidden
                        />
                        {TOUCHPOINT_LABELS[t.touchpoint]}
                      </span>
                    </TableCell>
                    <TableCell className={NUM}>{formatIDR(t.gmv)}</TableCell>
                    <TableCell className={NUM}>{pct(t.share)}</TableCell>
                    <TableCell className={NUM}>{signed(t.growth)}</TableCell>
                    <TableCell className={NUM}>{formatNumber(t.orders)}</TableCell>
                    <TableCell className={NUM}>{t.cost === null ? MISSING : formatIDR(t.cost)}</TableCell>
                    <TableCell className={NUM}>
                      {roas(t.roas)}
                      {t.roas !== null && t.roas < 2 ? (
                        <Badge variant="destructive" className="ml-2">
                          &lt; 2
                        </Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-6 text-sm text-muted-foreground">
              Laporan Kinerja Touchpoint untuk bulan ini belum diimpor.
            </p>
          )}
        </CardContent>
      </Card>

      {usedTouchpoints.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Komposisi GMV per touchpoint · 12 bulan</CardTitle>
            <CardDescription>
              Nilai per bulan ada di tooltip dan tabel touchpoint di atas (per bulan terpilih).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StackedColumns
              label={`Komposisi GMV per touchpoint ${data.info.sku}`}
              series={usedTouchpoints.map((tp) => ({
                key: tp,
                label: TOUCHPOINT_LABELS[tp],
                color: TP_COLORS[TOUCHPOINTS.indexOf(tp)],
              }))}
              data={data.touchpointTrend.map((m, i) => ({
                key: m.month,
                label: shortMonth(m.month),
                partial: trend[i]?.isPartial,
                values: m.byTouchpoint as Record<string, number>,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Riwayat kuadran & tren bulanan</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bulan</TableHead>
                <TableHead>Kuadran</TableHead>
                <TableHead className="text-right">GMV</TableHead>
                <TableHead className="text-right">Pesanan</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">AOV</TableHead>
                <TableHead className="text-right">Klik</TableHead>
                <TableHead className="text-right">Conv.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...trend].reverse().map((t) => {
                const q = data.quadrants[trend.indexOf(t)];
                return (
                  <TableRow key={t.month} className={t.month === data.month ? "bg-muted/50" : ""}>
                    <TableCell className="whitespace-nowrap">
                      {monthName(t.month)}
                      {t.isPartial ? " (MTD)" : ""}
                    </TableCell>
                    <TableCell>
                      <QuadrantBadge quadrant={q} />
                    </TableCell>
                    <TableCell className={NUM}>{t.gmv ? formatIDR(t.gmv) : MISSING}</TableCell>
                    <TableCell className={NUM}>{t.gmv ? formatNumber(t.orders) : MISSING}</TableCell>
                    <TableCell className={NUM}>{t.gmv ? formatNumber(t.units) : MISSING}</TableCell>
                    <TableCell className={NUM}>{formatIDR(t.aov === null ? null : Math.round(t.aov))}</TableCell>
                    <TableCell className={NUM}>{formatNumber(t.clicks)}</TableCell>
                    <TableCell className={NUM}>{pct(t.conversionRate, 2)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Listing marketplace</CardTitle>
          <CardDescription>Listing yang dipetakan ke SKU ini (Master Listing).</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Nama listing</TableHead>
                <TableHead>ID produk / SKU</TableHead>
                <TableHead className="text-right">Isi / listing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.listings.map((l) => (
                <TableRow key={`${l.channel}-${l.externalProductId}-${l.externalSkuId}`}>
                  <TableCell>{l.channel}</TableCell>
                  <TableCell>{l.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {l.externalProductId}
                    {l.externalSkuId ? ` / ${l.externalSkuId}` : ""}
                  </TableCell>
                  <TableCell className={NUM}>{l.unitsPerListing}×</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
