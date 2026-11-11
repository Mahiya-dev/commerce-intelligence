"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="Terjadi kesalahan saat memuat halaman"
      description={
        error.digest
          ? `Silakan coba lagi. Jika masalah berlanjut, laporkan kode referensi: ${error.digest}`
          : "Silakan coba lagi. Jika masalah berlanjut, hubungi admin."
      }
    >
      <Button variant="outline" onClick={reset}>
        Coba lagi
      </Button>
    </EmptyState>
  );
}
