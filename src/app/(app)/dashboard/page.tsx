import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Boxes, Link2, PackageSearch, ShoppingCart, Target, TrendingUp, Users, Wallet } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { getMasterDataSummary } from "@/lib/data/master-data";
import { NAVIGATION } from "@/config/navigation";
import { formatNumber } from "@/lib/format";
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
  const summary = await getMasterDataSummary(session);

  const modules = NAVIGATION.flatMap((s) => s.items).filter((i) => i.href !== "/dashboard");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Ringkasan kinerja lintas channel dan modul. Metrik penjualan akan tampil setelah data impor tervalidasi tersedia (Fase 2)."
        isDemo={organization.isDemo}
      />
      {organization.isDemo ? <DemoNotice /> : null}

      <section aria-labelledby="kpi-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="kpi-heading" className="text-sm font-semibold">
            KPI E-Commerce · Bulan berjalan
          </h2>
          <DataSourceLabel
            source="Laporan marketplace (belum diimpor)"
            updatedAt={null}
            timeZone={organization.timezone}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="GMV" value={null} hint="Belum ada data penjualan" icon={Wallet} />
          <KpiCard label="Orders" value={null} hint="Belum ada data penjualan" icon={ShoppingCart} />
          <KpiCard label="AOV" value={null} hint="Belum ada data penjualan" icon={TrendingUp} />
          <KpiCard label="Pencapaian Target" value={null} hint="Target belum ditetapkan" icon={Target} />
        </div>
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
                  {m.phase <= 1 ? (
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
