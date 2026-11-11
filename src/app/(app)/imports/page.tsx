import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";

export const metadata: Metadata = { title: "Impor Data" };

export default function Page() {
  return (
    <ModulePlaceholder
      href="/imports"
      dataSources="Unggahan Excel / CSV"
      capabilities={[
        "Unggah Excel/CSV dengan validasi ukuran & tipe file",
        "Identifikasi sumber dan jenis laporan, validasi kolom wajib",
        "Normalisasi tanggal & angka (format Indonesia), pemetaan ke metrik kanonik",
        "Deteksi impor duplikat (hash file) dan pratinjau perubahan sebelum commit",
        "Insert/update idempoten dengan pencatatan error per baris",
        "Jejak audit setiap batch impor",
      ]}
    />
  );
}
