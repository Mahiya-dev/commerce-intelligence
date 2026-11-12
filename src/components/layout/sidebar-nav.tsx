"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CURRENT_PHASE, getNavigationForRole, findNavItem } from "@/config/navigation";
import type { AppRole } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

export function SidebarNav({ role, onNavigate }: { role: AppRole; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = findNavItem(pathname);
  const sections = getNavigationForRole(role);

  return (
    <nav aria-label="Navigasi utama" className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-1">
          <p className="px-3 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{section.title}</p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const isActive = active?.href === item.href;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{item.title}</span>
                    {item.phase > CURRENT_PHASE ? (
                      <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">F{item.phase}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
