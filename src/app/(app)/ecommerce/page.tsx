import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, FileUp, ShoppingCart } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { getEcommerceOverview, getSalesForRange } from "@/lib/data/ecommerce";
import { RANGE_PRESET_LABELS } from "@/lib/ecommerce/date-range";
import { STATUS_THRESHOLDS } from "@/lib/ecommerce/kpi";
import { formatDate, formatIDR, formatNumber, formatPercent, MISSING } from "@/lib/format";
import { hasRole } from "@/lib/auth/roles";
import { PageHeader } from "@/components/shared/page-header";
import { DemoNotice } from "@/components/shared/demo-badge";
import { DataSourceLabel } from "@/components/shared/data-source-label";
import { EmptyState } from "@/components/shared/empty-state";
import { ChangeText, TargetStatusBadge } from "@/components/shared/target-status-badge";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "E-Commerce" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const day = (d: string) => formatDate(d, "UTC");
const period = (from: string, to: string) => (from === to ? day(from) : `${day(from)} – ${day(to)}`);
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const NUM = "text-right tabular-nums";
/** Fixed decimals so a column of percentages lines up ("3,40%" not "3,4%"). */
const pct = (v: number | null, digits: number) =>
  v === null || !Number.isFinite(v)
    ? MISSING
    : new Intl.NumberFormat("id-ID", {
        style: "percent",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(v);

export default async function EcommercePage({ searchParams }: PageProps<"/ecommerce">) {
  const item = requireNavItem("/ecommerce");
  const session = await requireRole(item.minRole);
  const { organization } = session;
  const sp = await searchParams;
  const [data, ranged] = await Promise.all([
    getEcommerceOverview(session),
    getSalesForRange(
      session,
      { range: first(sp.range), from: first(sp.from), to: first(sp.to) },
      { includeSkus: true },
    ),
  ]);

  const header = (
    <>
      <PageHeader
        title="E-Commerce"
        description="GMV, pesanan, AOV, conversion rate, target dan forecast per channel dari laporan marketplace yang sudah disimpan."
        isDemo={organization.isDemo}
      />
      {organization.isDemo ? <DemoNotice /> : null}
    </>
  );

  if (data.status === "empty" || ranged.status === "empty") {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={ShoppingCart}
          title="Belum ada data penjualan"
          description="Impor laporan Kinerja Toko Harian lalu simpan ke data e-commerce. Angka tidak pernah ditampilkan sebagai nol sebelum datanya ada."
        >
          {hasRole(session.role, "analyst") ? (
            <Button asChild>
              <Link href="/imports">
                <FileUp aria-hidden /> Impor Data
              </Link>
            </Button>
          ) : null}
        </EmptyState>
      </div>
    );
  }

  const name = new Map(data.channels.map((c) => [c.code, c.name]));
  const { targets, months, incomplete } = data;
  const { range } = ranged;
  const skus = ranged.skus ?? [];
  const skuCoverage = ranged.skuCoverage ?? { listingGmv: 0, shopGmv: 0 };
  const skuGap = skuCoverage.shopGmv - skuCoverage.listingGmv;
  const rangeLabel = `${RANGE_PRESET_LABELS[range.preset]}: ${period(range.from, range.to)}`;
  const channelRows = [
    ...ranged.channels.map((c) => ({ key: c.code, label: c.name, ...c })),
    {
      key: "all",
      label: "Semua channel",
      current: ranged.current,
      gmvChange: ranged.gmvChange,
      ordersChange: ranged.ordersChange,
      aovChange: ranged.aovChange,
    },
  ];

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm">
            <span className="font-medium">{rangeLabel}</span> · data s.d. {day(ranged.asOf)}
          </p>
          <DataSourceLabel
            source="Impor laporan Shopee, TikTok Shop, Tokopedia"
            updatedAt={data.lastImportAt}
            timeZone={organization.timezone}
          />
        </div>
        <DateRangeFilter
          key={`${range.preset}|${range.from}|${range.to}`}
          action="/ecommerce"
          preset={range.preset}
          from={range.from}
          to={range.to}
          min={ranged.dataFrom}
          max={ranged.asOf}
        />
      </div>
      {range.error ? <p className="text-xs text-destructive">{range.error}</p> : null}
      {range.clippedTo ? (
        <p className="text-xs text-muted-foreground">
          Rentang dipotong s.d. {day(range.clippedTo)} (data terakhir) agar perbandingan setara.
        </p>
      ) : null}

      {incomplete.length ? (
        <Alert variant="warning">
          <AlertTriangle aria-hidden />
          <AlertDescription>
            Data belum lengkap s.d. {day(data.asOf)}:{" "}
            {incomplete.map((c) => `${name.get(c.channel) ?? c.channel} kurang ${c.missingDays} hari`).join(", ")}. GMV,
            progres target dan forecast channel tersebut akan terlihat lebih rendah dari kenyataan.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Target bulan berjalan · {monthLabel(data.month)}</CardTitle>
          <CardDescription>
            Target bersifat bulanan sehingga tabel ini tidak mengikuti rentang tanggal. Progres = GMV s.d. hari ini ÷
            target yang seharusnya sudah tercapai (target × hari berjalan ÷ hari dalam bulan). On Track ≥{" "}
            {formatPercent(STATUS_THRESHOLDS.onTrack, 0)}, Watch ≥ {formatPercent(STATUS_THRESHOLDS.watch, 0)}, di
            bawahnya At Risk. Forecast = laju harian rata-rata × jumlah hari.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Target</TableHead>
                <TableHead className="text-right">GMV MTD</TableHead>
                <TableHead className="text-right">Seharusnya</TableHead>
                <TableHead className="text-right">Progres</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Dibutuhkan / hari</TableHead>
                <TableHead className="text-right">Forecast akhir bulan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...targets.rows, { channel: "", result: targets.all }].map(({ channel, result }) => (
                <TableRow key={channel || "all"} className={channel ? "" : "font-medium"}>
                  <TableCell>{channel ? (name.get(channel) ?? channel) : "Semua channel"}</TableCell>
                  {result ? (
                    <>
                      <TableCell className={NUM}>{formatIDR(result.target)}</TableCell>
                      <TableCell className={NUM}>{formatIDR(result.actual)}</TableCell>
                      <TableCell className={NUM}>{formatIDR(Math.round(result.expected))}</TableCell>
                      <TableCell className={NUM}>{pct(result.progress, 1)}</TableCell>
                      <TableCell>
                        <TargetStatusBadge status={result.status} />
                      </TableCell>
                      <TableCell className={NUM}>{formatIDR(Math.round(result.runRateNeeded))}</TableCell>
                      <TableCell className={NUM}>{formatIDR(Math.round(result.forecast))}</TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={7} className="text-muted-foreground">
                      Target belum diimpor
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {targets.channelsWithoutTarget.length && targets.all ? (
            <p className="px-6 pt-3 text-xs text-muted-foreground">
              Baris &quot;Semua channel&quot; hanya menghitung channel yang punya target.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Kinerja per channel · {period(range.from, range.to)}</CardTitle>
          <CardDescription>
            Dibandingkan {period(range.compare.from, range.compare.to)}
            {range.preset === "mtd" ? " (MoM periode setara)" : ""}. AOV = GMV ÷ pesanan; conversion rate = pesanan ÷
            pengunjung.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">GMV</TableHead>
                <TableHead className="text-right">Δ GMV</TableHead>
                <TableHead className="text-right">Pesanan</TableHead>
                <TableHead className="text-right">Δ Pesanan</TableHead>
                <TableHead className="text-right">AOV</TableHead>
                <TableHead className="text-right">Δ AOV</TableHead>
                <TableHead className="text-right">Pengunjung</TableHead>
                <TableHead className="text-right">Conv. rate</TableHead>
                <TableHead className="text-right">Unit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channelRows.map((r) => (
                <TableRow key={r.key} className={r.key === "all" ? "font-medium" : ""}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell className={NUM}>{formatIDR(r.current.gmv)}</TableCell>
                  <TableCell className={NUM}>
                    <ChangeText value={r.gmvChange} />
                  </TableCell>
                  <TableCell className={NUM}>{formatNumber(r.current.orders)}</TableCell>
                  <TableCell className={NUM}>
                    <ChangeText value={r.ordersChange} />
                  </TableCell>
                  <TableCell className={NUM}>
                    {formatIDR(r.current.aov === null ? null : Math.round(r.current.aov))}
                  </TableCell>
                  <TableCell className={NUM}>
                    <ChangeText value={r.aovChange} />
                  </TableCell>
                  <TableCell className={NUM}>{formatNumber(r.current.visitors)}</TableCell>
                  <TableCell className={NUM}>{pct(r.current.conversionRate, 2)}</TableCell>
                  <TableCell className={NUM}>{formatNumber(r.current.units)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {ranged.incomplete.length ? (
            <p className="px-6 pt-3 text-xs text-warning-foreground">
              Data belum lengkap pada rentang ini:{" "}
              {ranged.incomplete.map((c) => `${c.name} kurang ${c.missingDays} hari`).join(", ")}.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Ringkasan bulanan</CardTitle>
          <CardDescription>
            Riwayat 3 bulan terakhir (tidak mengikuti rentang tanggal). Bulan berjalan dihitung s.d. {day(data.asOf)}.
            &quot;Hari data&quot; = jumlah hari yang ada laporannya; kurang dari jumlah hari kalender berarti ada
            laporan yang belum diimpor.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bulan</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Hari data</TableHead>
                <TableHead className="text-right">GMV</TableHead>
                <TableHead className="text-right">Pesanan</TableHead>
                <TableHead className="text-right">AOV</TableHead>
                <TableHead className="text-right">Conv. rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.flatMap((m) =>
                [
                  ...m.rows.map((r) => ({ key: r.channel, label: name.get(r.channel) ?? r.channel, t: r.totals })),
                  {
                    key: "all",
                    label: "Semua channel",
                    t: m.all,
                  },
                ].map((r, i) => (
                  <TableRow key={`${m.month}-${r.key}`} className={r.key === "all" ? "font-medium" : ""}>
                    <TableCell className="text-muted-foreground">
                      {i === 0 ? `${monthLabel(m.month)}${m.isPartial ? " (MTD)" : ""}` : ""}
                    </TableCell>
                    <TableCell>{r.label}</TableCell>
                    <TableCell className={NUM}>{r.t.days ? formatNumber(r.t.days) : MISSING}</TableCell>
                    <TableCell className={NUM}>{r.t.days ? formatIDR(r.t.gmv) : MISSING}</TableCell>
                    <TableCell className={NUM}>{r.t.days ? formatNumber(r.t.orders) : MISSING}</TableCell>
                    <TableCell className={NUM}>{formatIDR(r.t.aov === null ? null : Math.round(r.t.aov))}</TableCell>
                    <TableCell className={NUM}>{pct(r.t.conversionRate, 2)}</TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Kontribusi SKU internal · {period(range.from, range.to)}</CardTitle>
          <CardDescription>
            Dari laporan Kinerja Produk Harian, dipetakan ke SKU lewat Master Listing. Unit = unit listing × isi per
            listing. Paket (bundle) tampil sebagai SKU-nya sendiri.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {skus.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground">
              Laporan Kinerja Produk Harian untuk rentang ini belum diimpor.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead className="text-right">GMV</TableHead>
                  <TableHead className="text-right">Porsi</TableHead>
                  <TableHead className="text-right">Unit SKU</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skus.map((s) => (
                  <TableRow key={s.sku ?? "unmapped"}>
                    <TableCell className="font-mono text-xs">{s.sku ?? "BELUM DIPETAKAN"}</TableCell>
                    <TableCell className={s.sku ? "" : "text-muted-foreground"}>
                      {s.name ?? "Listing belum dipetakan ke SKU internal"}
                    </TableCell>
                    <TableCell className={NUM}>{formatIDR(s.gmv)}</TableCell>
                    <TableCell className={NUM}>
                      {pct(skuCoverage.listingGmv ? s.gmv / skuCoverage.listingGmv : null, 1)}
                    </TableCell>
                    <TableCell className={NUM}>{formatNumber(s.units)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {skus.length && skuGap !== 0 ? (
            <p className="px-6 pt-3 text-xs text-muted-foreground">
              Total GMV produk ({formatIDR(skuCoverage.listingGmv)}) berbeda {formatIDR(Math.abs(skuGap))} dari GMV toko
              ({formatIDR(skuCoverage.shopGmv)}). Biasanya karena laporan produk belum diimpor untuk semua hari atau
              channel.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
