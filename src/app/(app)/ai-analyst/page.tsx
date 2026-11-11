import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";

export const metadata: Metadata = { title: "AI Analyst" };

export default function Page() {
  return (
    <ModulePlaceholder
      href="/ai-analyst"
      dataSources="Metrik terstruktur dari layanan aplikasi (bukan akses database langsung)"
      capabilities={[
        "Penjelasan pergerakan KPI dan deteksi anomali",
        "Identifikasi kemungkinan penyebab dengan bukti pendukung",
        "Rekomendasi aksi operasional dengan prioritas",
        "Tanya-jawab bisnis dalam bahasa natural",
        "Setiap insight memuat: temuan, bukti, periode, dugaan akar masalah, aksi, prioritas, keyakinan & keterbatasan data",
        "Semua angka berasal dari kalkulasi deterministik aplikasi; AI bersifat read-only",
      ]}
    />
  );
}
