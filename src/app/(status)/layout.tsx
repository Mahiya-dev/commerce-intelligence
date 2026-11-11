import type { ReactNode } from "react";

export default function StatusLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-svh items-center justify-center bg-muted/40 p-6">{children}</div>;
}
