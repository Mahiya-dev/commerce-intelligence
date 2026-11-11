import type { Metadata } from "next";
import { UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { signOut } from "@/app/(auth)/actions";

export const metadata: Metadata = { title: "Belum ada akses" };

export default function NoAccessPage() {
  return (
    <div className="w-full max-w-md">
      <EmptyState
        icon={UserX}
        title="Akun Anda belum terhubung ke organisasi"
        description="Login berhasil, tetapi akun ini belum memiliki keanggotaan aktif. Minta admin menambahkan Anda ke organisasi Madu Uray."
      >
        <form action={signOut}>
          <Button type="submit" variant="outline">
            Keluar
          </Button>
        </form>
      </EmptyState>
    </div>
  );
}
