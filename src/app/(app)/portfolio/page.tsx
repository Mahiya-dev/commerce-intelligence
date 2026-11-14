import type { Metadata } from "next";
import Link from "next/link";
import { Boxes, FileUp, Lightbulb } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { hasRole } from "@/lib/auth/roles";
import { getPortfolioOverview } from "@/lib/data/portfolio";
import { formatIDR, formatNumber, MISSING, monthName } from "@/lib/format";
import { QUADRANT_LABELS, type Quadrant } from "@/lib/portfolio/portfolio";
import { PageHeader } from "@/components/shared/page-header";
import { DemoNotice } from "@/components/shared/demo-badge";
import { DataSourceLabel } from "@/components/shared/data-source-label";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { MonthSelect } from "@/components/shared/month-select";
import { QuadrantBadge } from "@/components/shared/quadrant-badge";
import { MatrixScatter } from "@/components/charts/matrix-scatter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Portofolio Produk" };

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
const shortMonth = (ym: string) => `${monthName(ym).slice(0, 3)} ${ym.slice(2, 4)}`;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const ORDER: Quadrant[] = ["bintang", "penopang", "potensial", "evaluasi", "baru"];

export default async function PortfolioPage({ searchParams }: PageProps<"/portfolio">) {
  const item = requireNavItem("/portfolio");
  const session = await requireRole(item.minRole);
  const { organization } = session;
  const sp = await searchParams;
  const data = await getPortfolioOverview(session, { month: first(sp.month) });

  const header = (
    <>
      <PageHeader title={item.title} description={item.description} isDemo={organization.isDemo} />
      {organization.isDemo ? <DemoNotice /> : null}
    </>
  );

  if (data.status === "empty") {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={Boxes}
          title="Belum ada data kinerja produk"
          description="Impor laporan Kinerja Produk Harian (dan Master Listing untuk memetakan listing ke SKU) lalu simpan."
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

  const { matrix, skus, thresholds, recommendations } = data;
  const name = (sku: string) => skus[sku]?.name ?? sku;
  const counts = ORDER.map((q) => [q, matrix.rows.filter((r) => r.quadrant === q).length] as const);
  const plotted = matrix.rows.filter((r) => r.growth !== null);
  const newSkus = matrix.rows.filter((r) => r.growth === null);
  const asOfMonth = data.asOf.slice(0, 7);
  const linkFor = (sku: string) => `/portfolio/${encodeURIComponent(sku)}?month=${data.month}`;

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm">
            <span className="font-medium">{monthName(data.month)}</span>
            {matrix.isPartial ? " (MTD)" : ""} · dibandingkan {matrix.compare.from.slice(8)}–
            {matrix.compare.to.slice(8)} {monthName(matrix.compare.from.slice(0, 7))}
          </p>
          <DataSourceLabel
            source="Kinerja Produk Harian + Kinerja Touchpoint (SKU dari Master Listing)"
            updatedAt={data.lastImportAt}
            timeZone={organization.timezone}
          />
        </div>
        <MonthSelect action="/portfolio" months={data.months} value={data.month} partialMonth={asOfMonth} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {counts
          .filter(([q, n]) => q !== "baru" || n > 0)
          .map(([q, n]) => (
            <KpiCard
              key={q}
              label={QUADRANT_LABELS[q]}
              value={formatNumber(n)}
              hint={
                n
                  ? matrix.rows
                      .filter((r) => r.quadrant === q)
                      .map((r) => r.sku)
                      .join(", ")
                  : "Tidak ada SKU"
              }
            />
          ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Matriks portofolio internal · {monthName(data.month)}</CardTitle>
          <CardDescription>
            Porsi GMV tinggi bila ≥ {String(thresholds.shareFactor).replace(".", ",")}× rata-rata (
            {pct(matrix.shareThreshold)} untuk {matrix.activeSkus} SKU aktif); pertumbuhan tinggi bila ≥{" "}
            {signed(thresholds.growthThreshold)} dibanding bulan sebelumnya. Ini matriks internal, bukan BCG klasik
            (yang butuh data pangsa pasar eksternal). Ambang diatur Owner di Pengaturan → Organisasi.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {plotted.length ? (
            <MatrixScatter
              label={`Matriks portofolio ${monthName(data.month)}`}
              points={plotted.map((r) => ({
                sku: r.sku,
                name: name(r.sku),
                share: r.share,
                growth: r.growth!,
                gmv: r.current.gmv,
                quadrantLabel: QUADRANT_LABELS[r.quadrant],
              }))}
              shareThreshold={matrix.shareThreshold ?? 0}
              growthThreshold={matrix.growthThreshold}
              quadrantNames={["Potensial", "Bintang", "Evaluasi", "Penopang"]}
            />
          ) : null}
          {newSkus.length ? (
            <p className="text-xs text-muted-foreground">
              Tanpa pembanding bulan sebelumnya (Baru, tidak diplot): {newSkus.map((r) => r.sku).join(", ")}.
            </p>
          ) : null}
          {data.unmapped.gmv > 0 && data.month === asOfMonth ? (
            <p className="text-xs text-warning-foreground">
              {formatIDR(data.unmapped.gmv)} GMV bulan berjalan dari {data.unmapped.listings} listing belum dipetakan ke
              SKU dan tidak masuk matriks.{" "}
              <Link href="/master-data/listings" className="underline underline-offset-4">
                Lihat Channel Listing
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">SKU · {monthName(data.month)}</CardTitle>
          <CardDescription>Klik SKU untuk tren 12 bulan, touchpoint dan rekomendasi lengkap.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Kuadran</TableHead>
                <TableHead className="text-right">GMV</TableHead>
                <TableHead className="text-right">Porsi</TableHead>
                <TableHead className="text-right">Pertumbuhan</TableHead>
                <TableHead className="text-right">Pesanan</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">AOV</TableHead>
                <TableHead className="text-right">Conv.</TableHead>
                <TableHead>Rekomendasi utama</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.rows.map((r) => {
                const rec = recommendations[r.sku]?.[0];
                return (
                  <TableRow key={r.sku}>
                    <TableCell>
                      <Link
                        href={linkFor(r.sku)}
                        className="font-mono text-xs font-medium underline-offset-4 hover:underline"
                      >
                        {r.sku}
                      </Link>
                      <span className="block max-w-48 truncate text-xs text-muted-foreground">
                        {name(r.sku)}
                        {skus[r.sku]?.productType === "bundle" ? " · bundle" : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      <QuadrantBadge quadrant={r.quadrant} />
                    </TableCell>
                    <TableCell className={NUM}>{formatIDR(r.current.gmv, { compact: true })}</TableCell>
                    <TableCell className={NUM}>{pct(r.share)}</TableCell>
                    <TableCell className={NUM}>{signed(r.growth)}</TableCell>
                    <TableCell className={NUM}>{formatNumber(r.current.orders)}</TableCell>
                    <TableCell className={NUM}>{formatNumber(r.current.units)}</TableCell>
                    <TableCell className={NUM}>
                      {formatIDR(r.current.aov === null ? null : Math.round(r.current.aov))}
                    </TableCell>
                    <TableCell className={NUM}>{pct(r.current.conversionRate, 2)}</TableCell>
                    <TableCell className="max-w-72 text-xs whitespace-normal">
                      {rec ? (
                        <span className="flex items-start gap-1.5">
                          <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          {rec.title}
                        </span>
                      ) : (
                        MISSING
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Riwayat kuadran bulanan</CardTitle>
          <CardDescription>
            12 bulan terakhir. &ldquo;—&rdquo; = tidak ada penjualan; bulan pertama tanpa pembanding tampil sebagai
            Baru. Kuadran dihitung ulang dengan ambang saat ini.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-card">SKU</TableHead>
                {data.history.months.map((m) => (
                  <TableHead key={m} className="text-center">
                    {shortMonth(m)}
                    {m === asOfMonth ? "*" : ""}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.history.rows.map((r) => (
                <TableRow key={r.sku}>
                  <TableCell className="sticky left-0 bg-card">
                    <Link href={linkFor(r.sku)} className="font-mono text-xs underline-offset-4 hover:underline">
                      {r.sku}
                    </Link>
                  </TableCell>
                  {r.quadrants.map((q, i) => (
                    <TableCell
                      key={data.history.months[i]}
                      className={data.history.months[i] === data.month ? "bg-muted/50 text-center" : "text-center"}
                    >
                      <QuadrantBadge quadrant={q} compact />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="px-6 pt-3 text-xs text-muted-foreground">
            * bulan berjalan (MTD). Singkatan: Bin = Bintang, Pen = Penopang, Pot = Potensial, Eva = Evaluasi, Bar =
            Baru.{" "}
            <Badge variant="outline" className="ml-1">
              Matriks internal
            </Badge>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
