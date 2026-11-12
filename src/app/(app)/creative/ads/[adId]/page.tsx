import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Link2, MousePointerClick, ShoppingBag, Trophy, Wallet } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { can } from "@/lib/auth/roles";
import { getAdDetail } from "@/lib/data/creative";
import { formatDate, formatIDR, formatNumber, MISSING } from "@/lib/format";
import { FORMAT_LABELS, parseAdName } from "@/lib/creative/creative";
import { PageHeader } from "@/components/shared/page-header";
import { DemoNotice } from "@/components/shared/demo-badge";
import { KpiCard } from "@/components/shared/kpi-card";
import { ColumnChart } from "@/components/charts/column-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { resetToParsed, setAdAsset } from "../../actions";
import { ClassificationForm } from "../../forms";
import { decimal, FatigueBadge, NUM, pct, roasText, signed } from "../../creative-ui";

export const metadata: Metadata = { title: "Detail Iklan" };

const day = (d: string) => formatDate(d, "UTC");
const rupiah = (v: number | null) => formatIDR(v === null ? null : Math.round(v));
const SELECT =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:max-w-sm dark:bg-input/30";

export default async function AdDetailPage({ params }: PageProps<"/creative/ads/[adId]">) {
  const item = requireNavItem("/creative");
  const session = await requireRole(item.minRole);
  const { adId } = await params;
  if (!/^[0-9A-Za-z_-]{1,32}$/.test(adId)) notFound();
  const data = await getAdDetail(session, adId);
  if (data.status === "not_found") notFound();

  const { info, lifetime, last7, daily } = data;
  const canEdit = can(session.role, "creative:classify");
  const parsed = parseAdName(info.name);
  const recent = daily.slice(-60);

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/creative">
            <ArrowLeft aria-hidden /> Kreatif Meta
          </Link>
        </Button>
      </div>
      <PageHeader
        title={info.name}
        description={`Ad ID ${info.adId}${info.campaign ? ` · ${info.campaign}` : ""}${info.adset ? ` · ${info.adset}` : ""}`}
        isDemo={session.organization.isDemo}
        actions={<FatigueBadge status={data.fatigue.status} />}
      />
      {session.organization.isDemo ? <DemoNotice /> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Spend (seluruh periode)"
          value={formatIDR(lifetime.spend, { compact: true })}
          hint={
            daily.length
              ? `${day(daily[0].date)} – ${day(daily[daily.length - 1].date)} · ${lifetime.days} hari`
              : undefined
          }
          icon={Wallet}
        />
        <KpiCard
          label="ROAS"
          value={roasText(lifetime.roas)}
          hint={`7 hari terakhir ${roasText(last7.roas)}`}
          icon={Trophy}
        />
        <KpiCard
          label="CTR"
          value={pct(lifetime.ctr)}
          hint={`7 hari terakhir ${pct(last7.ctr)} · Δ awal→akhir ${signed(data.fatigue.ctrChange)}`}
          icon={MousePointerClick}
        />
        <KpiCard
          label="CPA"
          value={rupiah(lifetime.cpa)}
          hint={`${formatNumber(lifetime.purchases)} pembelian · frekuensi 7 hari ${decimal(data.fatigue.recentFrequency)}`}
          icon={ShoppingBag}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Spend harian · {recent.length} hari terakhir</CardTitle>
          <CardDescription>
            Tooltip menampilkan CTR, pembelian dan ROAS per hari; nilai lengkap di tabel bawah.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ColumnChart
            label={`Spend harian iklan ${info.adId}`}
            valueLabel="Spend"
            data={recent.map((f) => ({
              key: f.date,
              label:
                f.date.slice(8) === "01" || f === recent[0]
                  ? `${f.date.slice(8)}/${f.date.slice(5, 7)}`
                  : f.date.slice(8),
              value: f.spend,
              details: [
                { label: "CTR", value: pct(f.impressions ? f.clicks / f.impressions : null) },
                { label: "Pembelian", value: formatNumber(f.purchases) },
                { label: "ROAS", value: roasText(f.spend ? f.revenue / f.spend : null) },
              ],
            }))}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              Klasifikasi
              {info.source === "manual" ? (
                <Badge variant="outline">Dikoreksi manual</Badge>
              ) : (
                <Badge variant="outline">Dari nama iklan</Badge>
              )}
              {info.parseStatus !== "ok" ? <Badge variant="warning">Nama tidak standar</Badge> : null}
            </CardTitle>
            <CardDescription>
              Konvensi: PRODUK_HOOK_ANGLE_FORMAT_BATCH_VERSI (format MI, VIF, VID, IMG, CAR). Koreksi manual tidak
              ditimpa impor berikutnya.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {canEdit ? (
              <>
                <ClassificationForm
                  key={`${info.source}|${info.hook}|${info.angle}|${info.format}`}
                  adId={info.adId}
                  values={{
                    product: info.product ?? "",
                    hook: info.hook ?? "",
                    angle: info.angle ?? "",
                    format: info.format ?? "",
                    batch: info.batch ?? "",
                    version: info.version ?? "",
                  }}
                />
                {info.source === "manual" ? (
                  <form action={resetToParsed}>
                    <input type="hidden" name="adId" value={info.adId} />
                    <Button type="submit" variant="outline" size="sm">
                      Kembalikan ke hasil parsing nama ({parsed.status === "ok" ? "lengkap" : "tidak lengkap"})
                    </Button>
                  </form>
                ) : null}
              </>
            ) : (
              <dl className="grid grid-cols-3 gap-2 text-sm">
                {(
                  [
                    ["Produk", info.product],
                    ["Hook", info.hook],
                    ["Angle", info.angle],
                    ["Format", info.format ? FORMAT_LABELS[info.format] : null],
                    ["Batch", info.batch],
                    ["Versi", info.version],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-medium">{v ?? MISSING}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Link2 className="size-4" aria-hidden /> Aset kreatif
            </CardTitle>
            <CardDescription>Tautkan iklan ke aset di library untuk melihat kinerja per aset.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm">
              Saat ini: <span className="font-medium">{info.assetName ?? "Belum ditautkan"}</span>
            </p>
            {canEdit ? (
              <form action={setAdAsset} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="adId" value={info.adId} />
                <label htmlFor="assetId" className="sr-only">
                  Aset
                </label>
                <select id="assetId" name="assetId" defaultValue={info.assetId ?? ""} className={SELECT}>
                  <option value="">— tidak ditautkan —</option>
                  {data.assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="outline">
                  Simpan
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Data harian</CardTitle>
        </CardHeader>
        <CardContent className="max-h-[28rem] overflow-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Impresi</TableHead>
                <TableHead className="text-right">Frekuensi</TableHead>
                <TableHead className="text-right">Klik</TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead className="text-right">Pembelian</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...daily].reverse().map((f) => (
                <TableRow key={f.date}>
                  <TableCell className="whitespace-nowrap">{day(f.date)}</TableCell>
                  <TableCell className={NUM}>{formatIDR(f.spend)}</TableCell>
                  <TableCell className={NUM}>{formatNumber(f.impressions)}</TableCell>
                  <TableCell className={NUM}>{decimal(f.reach ? f.impressions / f.reach : null, 2)}</TableCell>
                  <TableCell className={NUM}>{formatNumber(f.clicks)}</TableCell>
                  <TableCell className={NUM}>{pct(f.impressions ? f.clicks / f.impressions : null)}</TableCell>
                  <TableCell className={NUM}>{formatNumber(f.purchases)}</TableCell>
                  <TableCell className={NUM}>{formatIDR(f.revenue)}</TableCell>
                  <TableCell className={NUM}>{roasText(f.spend ? f.revenue / f.spend : null)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
