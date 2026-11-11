import Link from "next/link";
import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "Akses ditolak" };

export default function ForbiddenPage() {
  return (
    <div className="w-full max-w-md">
      <EmptyState
        icon={ShieldAlert}
        title="Akses ditolak (403)"
        description="Peran Anda tidak memiliki izin untuk membuka halaman ini. Hubungi admin organisasi bila Anda memerlukan akses."
      >
        <Button asChild variant="outline">
          <Link href="/dashboard">Kembali ke Dashboard</Link>
        </Button>
      </EmptyState>
    </div>
  );
}
