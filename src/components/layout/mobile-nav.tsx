"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Brand } from "@/components/layout/brand";
import type { AppRole } from "@/lib/auth/roles";

export function MobileNav({ role }: { role: AppRole }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Buka navigasi">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="overflow-y-auto bg-sidebar p-4">
        <SheetTitle className="sr-only">Navigasi</SheetTitle>
        <SheetDescription className="sr-only">Menu navigasi aplikasi</SheetDescription>
        <Brand />
        <SidebarNav role={role} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
