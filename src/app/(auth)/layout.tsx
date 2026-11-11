import type { ReactNode } from "react";
import { Hexagon } from "lucide-react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-6">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Hexagon className="size-5" aria-hidden />
        </span>
        <div className="leading-tight">
          <p className="font-semibold">Uray Commerce Intelligence</p>
          <p className="text-xs text-muted-foreground">Madu Uray · Aplikasi internal</p>
        </div>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
