import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";

export const metadata: Metadata = { title: "E-Commerce" };

export default function Page() {
  return (
    <ModulePlaceholder
      href="/ecommerce"
      dataSources="Impor laporan Shopee, TikTok Shop, Tokopedia"
      capabilities={[
        "Dashboard harian, mingguan dan bulanan: GMV, Orders, AOV, Conversion Rate, Units Sold, Visitors, Product Clicks",
        "Perbandingan MoM pada periode setara (hari ke-1 s.d. N vs bulan lalu)",
        "Pencapaian target, expected cumulative progress dan forecast GMV akhir bulan",
        "Required daily run rate dan scorecard On Track / Watch / At Risk",
        "Analisis daya beli mingguan historis",
        "Drilldown per channel dan per SKU, termasuk refund & pembatalan bila tersedia",
      ]}
    />
  );
}
