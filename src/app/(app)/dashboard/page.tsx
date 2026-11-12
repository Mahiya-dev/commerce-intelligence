import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Boxes, Link2, PackageSearch, ShoppingCart, Target, TrendingUp, Users, Wallet } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { getMasterDataSummary } from "@/lib/data/master-data";
import { CURRENT_PHASE, NAVIGATION } from "@/config/navigation";
import { getEcommerceOverview } from "@/lib/data/ecommerce";
import { formatDate, formatIDR, formatNumber, formatPercent } from "@/lib/format";
import { formatChange, TARGET_STATUS_LABEL } from "@/components/shared/target-status-badge";
import { PageHeader } from "@/components/shared/page-header";
import { DemoNotice } from "@/components/shared/demo-badge";
import { DataSourceLabel } from "@/components/shared/data-source-label";
import { KpiCard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await requireRole("viewer");
  const { organization } = session;
  const [summary, sales] = await Promise.all([getMasterDataSummary(session), getEcommerceOverview(session)]);
  const ok = sales.status === "ok" ? sales : null;
  const vsLastMonth = ok
    ? `vs ${formatDate(ok.mom.previous.from, "UTC")} – ${formatDate(ok.mom.previous.to, "UTC")}`
    : "";
  const target = ok?.targets.all ?? null;

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
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="kpi-heading" className="text-sm font-semibold">
            KPI E-Commerce · {ok ? `MTD s.d. ${formatDate(ok.asOf, "UTC")}` : "Bulan berjalan"}
          </h2>
          <DataSourceLabel
            source={ok ? "Laporan marketplace" : "Laporan marketplace (belum diimpor)"}
            updatedAt={ok?.lastImportAt ?? null}
            timeZone={organization.timezone}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="GMV"
            value={ok ? formatIDR(ok.mom.all.current.gmv, { compact: true }) : null}
            hint={ok ? `${formatChange(ok.mom.all.gmvChange)} ${vsLastMonth}` : "Belum ada data penjualan"}
            icon={Wallet}
          />
          <KpiCard
            label="Orders"
            value={ok ? formatNumber(ok.mom.all.current.orders) : null}
            hint={ok ? `${formatChange(ok.mom.all.ordersChange)} ${vsLastMonth}` : "Belum ada data penjualan"}
            icon={ShoppingCart}
          />
          <KpiCard
            label="AOV"
            value={ok ? formatIDR(ok.mom.all.current.aov === null ? null : Math.round(ok.mom.all.current.aov)) : null}
            hint={
              ok ? `Conversion rate ${formatPercent(ok.mom.all.current.conversionRate, 2)}` : "Belum ada data penjualan"
            }
            icon={TrendingUp}
          />
          <KpiCard
            label="Pencapaian Target"
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
        {ok?.incomplete.length ? (
          <p className="text-xs text-warning-foreground">
            Data belum lengkap untuk {ok.incomplete.length} channel; lihat halaman E-Commerce.
          </p>
        ) : null}
      </section>

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
