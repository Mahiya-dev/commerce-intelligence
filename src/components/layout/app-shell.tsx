import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth/guards";
import { Brand } from "@/components/layout/brand";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { DemoBadge } from "@/components/shared/demo-badge";

/** Authenticated application chrome. Resolves the session (server-side). */
export async function AppShell({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const { organization, user, role } = session;

  return (
    <div className="flex min-h-svh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Lewati ke konten utama
      </a>
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r bg-sidebar p-4 lg:flex">
        <Brand />
        <SidebarNav role={role} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-6">
          <MobileNav role={role} />
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{organization.name}</span>
            {organization.isDemo ? <DemoBadge /> : null}
          </div>
          <div className="ml-auto">
            <UserMenu name={user.fullName} email={user.email} role={role} />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}

export function AppShellSkeleton() {
  return (
    <div className="flex min-h-svh" aria-busy="true" aria-label="Memuat aplikasi">
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar p-4 lg:block">
        <div className="h-8 w-36 animate-pulse rounded-md bg-accent" />
        <div className="mt-8 space-y-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded-md bg-accent/70" />
          ))}
        </div>
      </aside>
      <div className="flex-1">
        <div className="h-14 border-b" />
        <div className="space-y-4 p-6">
          <div className="h-7 w-64 animate-pulse rounded-md bg-accent" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-accent/70" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
