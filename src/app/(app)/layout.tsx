import { Suspense, type ReactNode } from "react";
import { AppShell, AppShellSkeleton } from "@/components/layout/app-shell";

/**
 * Authenticated area. The session is read inside a Suspense boundary
 * (required by Cache Components); unauthenticated users never get here
 * because the proxy redirects them, and AppShell re-verifies server-side.
 */
export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
