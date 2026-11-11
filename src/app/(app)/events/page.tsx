import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";

export const metadata: Metadata = { title: "Profitabilitas Event" };

export default function Page() {
  return (
    <ModulePlaceholder
      href="/events"
      dataSources="Input event, biaya, dan COGS produk"
      capabilities={[
        "Pembuatan event dan halaman detail event",
        "Pencatatan pendapatan, biaya tetap dan biaya variabel",
        "COGS produk, contribution profit, break-even revenue dan ROI",
        "Perbandingan antar event",
        "Pelacakan lead dan atribusi pasca-event",
        "Profitabilitas tidak pernah dihitung dari gross revenue saja",
      ]}
    />
  );
}
