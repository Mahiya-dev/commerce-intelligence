import type { Metadata } from "next";
import Link from "next/link";
import { FileUp, Flame, Megaphone, MousePointerClick, ShoppingBag, Trophy, Wallet } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { requireNavItem } from "@/config/navigation";
import { hasRole } from "@/lib/auth/roles";
import { getCreativeOverview } from "@/lib/data/creative";
import { RANGE_PRESET_LABELS } from "@/lib/ecommerce/date-range";
import { formatDate, formatIDR, formatNumber, MISSING } from "@/lib/format";
import {
  FATIGUE_CTR_DROP,
  FATIGUE_FREQUENCY,
  FORMAT_LABELS,
  WINNER_MIN_PURCHASES,
  WINNER_MIN_SPEND,
  WINNER_ROAS_LIFT,
  type AdMetrics,
  type CreativeFormat,
} from "@/lib/creative/creative";
import { PageHeader } from "@/components/shared/page-header";
import { DemoNotice } from "@/components/shared/demo-badge";
import { DataSourceLabel } from "@/components/shared/data-source-label";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { ChangeText, formatChange } from "@/components/shared/target-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { change, CreativeTabs, decimal, FatigueBadge, NUM, pct, roasText, signed } from "./creative-ui";

export const metadata: Metadata = { title: "Kreatif Meta" };

const day = (d: string) => formatDate(d, "UTC");
const period = (from: string, to: string) => (from === to ? day(from) : `${day(from)} – ${day(to)}`);
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const rupiah = (v: number | null) => formatIDR(v === null ? null : Math.round(v));

function MetricCells({ m }: { m: AdMetrics }) {
  return (
    <>
      <TableCell className={NUM}>{formatIDR(m.spend, { compact: true })}</TableCell>
      <TableCell className={NUM}>{formatIDR(m.revenue, { compact: true })}</TableCell>
      <TableCell className={NUM}>{roasText(m.roas)}</TableCell>
      <TableCell className={NUM}>{pct(m.ctr)}</TableCell>
      <TableCell className={NUM}>{rupiah(m.cpc)}</TableCell>
      <TableCell className={NUM}>{rupiah(m.cpm)}</TableCell>
      <TableCell className={NUM}>{rupiah(m.cpa)}</TableCell>
      <TableCell className={NUM}>{formatNumber(m.purchases)}</TableCell>
    </>
  );
}

const METRIC_HEADS = ["Spend", "Revenue", "ROAS", "CTR", "CPC", "CPM", "CPA", "Pembelian"];

function GroupTable({
  title,
  description,
  rows,
  label,
}: {
  title: string;
  description: string;
  rows: { key: string | null; ads: number; metrics: AdMetrics }[];
  label: (key: string | null) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{title.split(" ")[0]}</TableHead>
              <TableHead className="text-right">Iklan</TableHead>
              {METRIC_HEADS.map((h) => (
                <TableHead key={h} className="text-right">
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key ?? "none"}>
                <TableCell className={r.key ? "" : "text-muted-foreground"}>{label(r.key)}</TableCell>
                <TableCell className={NUM}>{r.ads}</TableCell>
                <MetricCells m={r.metrics} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default async function CreativePage({ searchParams }: PageProps<"/creative">) {
  const item = requireNavItem("/creative");
  const session = await requireRole(item.minRole);
  const { organization } = session;
  const sp = await searchParams;
  const data = await getCreativeOverview(session, { range: first(sp.range), from: first(sp.from), to: first(sp.to) });

  const header = (
    <>
      <PageHeader
        title={item.title}
        description={item.description}
        isDemo={organization.isDemo}
        actions={<CreativeTabs active="overview" />}
      />
      {organization.isDemo ? <DemoNotice /> : null}
    </>
  );

  if (data.status === "empty") {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={Megaphone}
          title="Belum ada data iklan Meta"
          description="Impor laporan Performa Iklan Meta Harian (Ad ID asli dipertahankan) lalu simpan."
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

  const { range, current, previous, ads, miVsVif } = data;
  const vs = `vs ${period(range.compare.from, range.compare.to)}`;
  const winners = ads.filter((a) => a.winner).sort((a, b) => (b.metrics.roas ?? 0) - (a.metrics.roas ?? 0));
  const fatigued = ads.filter((a) => a.fatigue.status === "lelah" || a.fatigue.status === "waspada");
  const unparsed = ads.filter((a) => a.parseStatus !== "ok" && a.source === "parsed");
  const formatLabel = (k: string | null) => (k ? FORMAT_LABELS[k as CreativeFormat] : "Tidak terklasifikasi");
  const plain = (k: string | null) => k ?? "Tidak terklasifikasi";

  const duel: [string, AdMetrics | null][] = [
    ["Motion Image", miVsVif.mi],
    ["Video in Frame", miVsVif.vif],
  ];

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm">
            <span className="font-medium">{RANGE_PRESET_LABELS[range.preset]}</span>: {period(range.from, range.to)} ·
            data s.d. {day(data.asOf)}
          </p>
          <DataSourceLabel source="Impor Meta Ads" updatedAt={data.lastImportAt} timeZone={organization.timezone} />
        </div>
        <DateRangeFilter
          key={`${range.preset}|${range.from}|${range.to}`}
          action="/creative"
          preset={range.preset}
          from={range.from}
          to={range.to}
          min={data.dataFrom}
          max={data.asOf}
        />
      </div>
      {range.error ? <p className="text-xs text-destructive">{range.error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Spend"
          value={formatIDR(current.spend, { compact: true })}
          hint={`${formatChange(change(current.spend, previous.spend))} ${vs}`}
          icon={Wallet}
        />
        <KpiCard
          label="Revenue (nilai pembelian)"
          value={formatIDR(current.revenue, { compact: true })}
          hint={`${formatChange(change(current.revenue, previous.revenue))} ${vs}`}
          icon={ShoppingBag}
        />
        <KpiCard
          label="ROAS"
          value={roasText(current.roas)}
          hint={`Sebelumnya ${roasText(previous.roas)}`}
          icon={Trophy}
        />
        <KpiCard
          label="CPA"
          value={rupiah(current.cpa)}
          hint={`${formatNumber(current.purchases)} pembelian`}
          icon={Megaphone}
        />
        <KpiCard
          label="CTR"
          value={pct(current.ctr)}
          hint={`CPC ${rupiah(current.cpc)} · CPM ${rupiah(current.cpm)}`}
          icon={MousePointerClick}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Motion Image vs Video in Frame</CardTitle>
          <CardDescription>
            Perbandingan dua format utama pada rentang ini (berdasarkan klasifikasi nama iklan).
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Format</TableHead>
                {METRIC_HEADS.map((h) => (
                  <TableHead key={h} className="text-right">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {duel.map(([label, m]) => (
                <TableRow key={label}>
                  <TableCell className="font-medium">{label}</TableCell>
                  {m ? (
                    <MetricCells m={m} />
                  ) : (
                    <TableCell colSpan={8} className="text-muted-foreground">
                      Tidak ada iklan dengan format ini pada rentang ini
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {miVsVif.mi && miVsVif.vif ? (
                <TableRow className="text-muted-foreground">
                  <TableCell>VIF vs MI</TableCell>
                  <TableCell className={NUM}>{signed(change(miVsVif.vif.spend, miVsVif.mi.spend))}</TableCell>
                  <TableCell className={NUM}>{signed(change(miVsVif.vif.revenue, miVsVif.mi.revenue))}</TableCell>
                  <TableCell className={NUM}>
                    <ChangeText value={change(miVsVif.vif.roas, miVsVif.mi.roas)} />
                  </TableCell>
                  <TableCell className={NUM}>
                    <ChangeText value={change(miVsVif.vif.ctr, miVsVif.mi.ctr)} />
                  </TableCell>
                  <TableCell className={NUM}>{signed(change(miVsVif.vif.cpc, miVsVif.mi.cpc))}</TableCell>
                  <TableCell className={NUM}>{signed(change(miVsVif.vif.cpm, miVsVif.mi.cpm))}</TableCell>
                  <TableCell className={NUM}>{signed(change(miVsVif.vif.cpa, miVsVif.mi.cpa))}</TableCell>
                  <TableCell className={NUM}>{signed(change(miVsVif.vif.purchases, miVsVif.mi.purchases))}</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Trophy className="size-4" aria-hidden /> Pemenang kreatif
            </CardTitle>
            <CardDescription>
              Spend ≥ {formatIDR(WINNER_MIN_SPEND)}, ≥ {WINNER_MIN_PURCHASES} pembelian, dan ROAS ≥{" "}
              {String(WINNER_ROAS_LIFT).replace(".", ",")}× ROAS akun ({roasText(current.roas)}).
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {winners.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Iklan</TableHead>
                    <TableHead className="text-right">ROAS</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">CPA</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {winners.map((a) => (
                    <TableRow key={a.adId}>
                      <TableCell>
                        <Link
                          href={`/creative/ads/${a.adId}`}
                          className="text-xs font-medium underline-offset-4 hover:underline"
                        >
                          {a.name}
                        </Link>
                      </TableCell>
                      <TableCell className={NUM}>{roasText(a.metrics.roas)}</TableCell>
                      <TableCell className={NUM}>{formatIDR(a.metrics.spend, { compact: true })}</TableCell>
                      <TableCell className={NUM}>{rupiah(a.metrics.cpa)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="px-6 text-sm text-muted-foreground">Belum ada iklan yang memenuhi kriteria pemenang.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Flame className="size-4" aria-hidden /> Pantauan creative fatigue
            </CardTitle>
            <CardDescription>
              7 hari aktif terakhir vs 7 hari pertama. Lelah: CTR turun ≥ {pct(FATIGUE_CTR_DROP, 0)} dan frekuensi ≥{" "}
              {FATIGUE_FREQUENCY} atau CPA naik ≥ {pct(FATIGUE_CTR_DROP, 0)}; Waspada: CTR turun ≥ 15%.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {fatigued.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Iklan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Δ CTR</TableHead>
                    <TableHead className="text-right">Δ CPA</TableHead>
                    <TableHead className="text-right">Frekuensi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fatigued.map((a) => (
                    <TableRow key={a.adId}>
                      <TableCell>
                        <Link
                          href={`/creative/ads/${a.adId}`}
                          className="text-xs font-medium underline-offset-4 hover:underline"
                        >
                          {a.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <FatigueBadge status={a.fatigue.status} />
                      </TableCell>
                      <TableCell className={NUM}>{signed(a.fatigue.ctrChange)}</TableCell>
                      <TableCell className={NUM}>{signed(a.fatigue.cpaChange)}</TableCell>
                      <TableCell className={NUM}>{decimal(a.fatigue.recentFrequency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="px-6 text-sm text-muted-foreground">Tidak ada iklan yang terindikasi lelah.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <GroupTable
        title="Format kreatif"
        description="Semua format pada rentang ini."
        rows={data.formats}
        label={formatLabel}
      />
      <div className="grid gap-6 2xl:grid-cols-2">
        <GroupTable title="Hook" description="Kinerja per hook (dari nama iklan)." rows={data.hooks} label={plain} />
        <GroupTable title="Angle" description="Kinerja per angle (dari nama iklan)." rows={data.angles} label={plain} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Semua iklan aktif · {period(range.from, range.to)}</CardTitle>
          <CardDescription>
            Klik iklan untuk tren harian, koreksi klasifikasi dan menautkan aset.
            {unparsed.length ? ` ${unparsed.length} nama iklan tidak sesuai konvensi dan perlu dikoreksi.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Iklan</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Hook · Angle</TableHead>
                {METRIC_HEADS.map((h) => (
                  <TableHead key={h} className="text-right">
                    {h}
                  </TableHead>
                ))}
                <TableHead>Fatigue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ads.map((a) => (
                <TableRow key={a.adId}>
                  <TableCell className="max-w-72">
                    <Link
                      href={`/creative/ads/${a.adId}`}
                      className="block truncate text-xs font-medium underline-offset-4 hover:underline"
                      title={a.name}
                    >
                      {a.name}
                    </Link>
                    <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <span className="font-mono">{a.adId}</span>
                      {a.winner ? <Badge variant="success">Pemenang</Badge> : null}
                      {a.parseStatus !== "ok" ? <Badge variant="warning">Nama tidak standar</Badge> : null}
                      {a.source === "manual" ? <Badge variant="outline">Dikoreksi</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{a.format ? FORMAT_LABELS[a.format] : MISSING}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {a.hook ?? MISSING} · {a.angle ?? MISSING}
                  </TableCell>
                  <MetricCells m={a.metrics} />
                  <TableCell>
                    <FatigueBadge status={a.fatigue.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
