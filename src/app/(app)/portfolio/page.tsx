import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";

export const metadata: Metadata = { title: "Portofolio Produk" };

export default function Page() {
  return (
    <ModulePlaceholder
      href="/portfolio"
      dataSources="Fakta penjualan per SKU + master produk"
      capabilities={[
        "Tren GMV, AOV, orders, units, clicks dan impressions per produk",
        "Pertumbuhan MoM per SKU dan per bundle",
        "Matriks portofolio internal (kontribusi GMV internal × pertumbuhan)",
        "Klasifikasi BCG klasik hanya bila data pangsa pasar eksternal tersedia",
        "Riwayat kuadran bulanan dan halaman detail produk",
        "Rekomendasi touchpoint berdasarkan performa",
      ]}
    />
  );
}
