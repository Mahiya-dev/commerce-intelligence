import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";

export const metadata: Metadata = { title: "Afiliasi HSL" };

export default function Page() {
  return (
    <ModulePlaceholder
      href="/affiliates"
      dataSources="Impor Shopee HSL + pergerakan stok"
      capabilities={[
        "Master database afiliasi",
        "Impor data penjualan HSL: GMV dan unit terjual per afiliasi",
        "Pelacakan locked inventory, sell-through rate dan sales velocity",
        "Peringkat performa afiliasi",
        "Rekomendasi alokasi kuantitas dengan multiple yang dapat dikonfigurasi",
        "Persetujuan manusia sebelum perubahan alokasi; tidak pernah melebihi stok tersedia",
      ]}
    />
  );
}
