import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";

export const metadata: Metadata = { title: "Kreatif Meta" };

export default function Page() {
  return (
    <ModulePlaceholder
      href="/creative"
      dataSources="Impor Meta Ads + library aset"
      capabilities={[
        "Library aset kreatif (gambar & video) dengan unggahan aman",
        "Impor performa iklan Meta dengan Ad ID asli dipertahankan",
        "Parsing konvensi penamaan iklan: hook, angle, format, batch, versi — dapat dikoreksi pengguna",
        "Perbandingan Motion Image vs Video in Frame",
        "CTR, CPC, CPM, CPA, ROAS, spend, purchases, revenue",
        "Identifikasi pemenang kreatif dan pemantauan creative fatigue",
      ]}
    />
  );
}
