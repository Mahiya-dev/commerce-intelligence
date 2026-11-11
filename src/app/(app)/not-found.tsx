import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

export default function NotFound() {
  return (
    <EmptyState icon={SearchX} title="Halaman tidak ditemukan" description="Periksa kembali alamat halaman.">
      <Button asChild variant="outline">
        <Link href="/dashboard">Kembali ke Dashboard</Link>
      </Button>
    </EmptyState>
  );
}
