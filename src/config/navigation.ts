import type { LucideIcon } from "lucide-react";
import {
  BadgeDollarSign,
  Bot,
  Boxes,
  CalendarRange,
  FileUp,
  History,
  LayoutDashboard,
  Link2,
  Megaphone,
  Settings2,
  ShoppingCart,
  Users,
  UsersRound,
} from "lucide-react";
import { hasRole, type AppRole } from "@/lib/auth/roles";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Minimum role required to see AND open this route (enforced server-side too). */
  minRole: AppRole;
  /** Delivery phase in which the module becomes functional. */
  phase: number;
  description: string;
};

export type NavSection = { title: string; items: NavItem[] };

/** Latest delivered phase: modules with phase <= CURRENT_PHASE are functional. */
export const CURRENT_PHASE = 5;

export const NAVIGATION: NavSection[] = [
  {
    title: "Ringkasan",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        minRole: "viewer",
        phase: 2,
        description: "Ringkasan kinerja lintas modul dan peringatan dini.",
      },
    ],
  },
  {
    title: "Analitik",
    items: [
      {
        title: "E-Commerce",
        href: "/ecommerce",
        icon: ShoppingCart,
        minRole: "viewer",
        phase: 2,
        description:
          "GMV, Orders, AOV, Conversion Rate, target & forecast per channel (Shopee, TikTok Shop, Tokopedia).",
      },
      {
        title: "Portofolio Produk",
        href: "/portfolio",
        icon: Boxes,
        minRole: "viewer",
        phase: 3,
        description: "Tren SKU, pertumbuhan MoM, matriks portofolio internal dan riwayat kuadran bulanan.",
      },
      {
        title: "Kreatif Meta",
        href: "/creative",
        icon: Megaphone,
        minRole: "viewer",
        phase: 4,
        description: "Library kreatif, performa iklan Meta, pemenang kreatif dan creative fatigue.",
      },
      {
        title: "Profitabilitas Event",
        href: "/events",
        icon: CalendarRange,
        minRole: "viewer",
        phase: 5,
        description: "Pendapatan, biaya tetap & variabel, COGS, contribution profit, break-even dan ROI event.",
      },
      {
        title: "Afiliasi HSL",
        href: "/affiliates",
        icon: UsersRound,
        minRole: "viewer",
        phase: 5,
        description: "Kinerja afiliasi Shopee HSL, sell-through, sales velocity dan rekomendasi alokasi stok.",
      },
    ],
  },
  {
    title: "AI",
    items: [
      {
        title: "AI Analyst",
        href: "/ai-analyst",
        icon: Bot,
        minRole: "viewer",
        phase: 6,
        description: "Penjelasan pergerakan KPI, anomali, dan rekomendasi berbasis bukti dari Gemini.",
      },
    ],
  },
  {
    title: "Data",
    items: [
      {
        title: "Impor Data",
        href: "/imports",
        icon: FileUp,
        minRole: "analyst",
        phase: 2,
        description:
          "Impor dari Excel/CSV, Google Spreadsheet atau API marketplace; validasi kolom, pratinjau perubahan dan riwayat impor.",
      },
      {
        title: "Master Produk",
        href: "/master-data/products",
        icon: BadgeDollarSign,
        minRole: "viewer",
        phase: 1,
        description: "Master produk, varian SKU, bundle dan standard COGS.",
      },
      {
        title: "Channel Listing",
        href: "/master-data/listings",
        icon: Link2,
        minRole: "viewer",
        phase: 1,
        description: "Pemetaan listing marketplace ke SKU internal.",
      },
    ],
  },
  {
    title: "Pengaturan",
    items: [
      {
        title: "Organisasi",
        href: "/settings/organization",
        icon: Settings2,
        minRole: "admin",
        phase: 1,
        description: "Profil organisasi, zona waktu dan pengaturan KPI.",
      },
      {
        title: "Pengguna & Akses",
        href: "/settings/members",
        icon: Users,
        minRole: "admin",
        phase: 1,
        description: "Daftar anggota organisasi beserta perannya.",
      },
      {
        title: "Audit Log",
        href: "/settings/audit-log",
        icon: History,
        minRole: "admin",
        phase: 1,
        description: "Jejak perubahan data master dan konfigurasi.",
      },
    ],
  },
];

export function getNavigationForRole(role: AppRole | null | undefined): NavSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => hasRole(role, item.minRole)),
  })).filter((section) => section.items.length > 0);
}

/** Longest-prefix match so nested routes resolve to their module. */
export function findNavItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const section of NAVIGATION) {
    for (const item of section.items) {
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (matches && (!best || item.href.length > best.href.length)) best = item;
    }
  }
  return best;
}

export function requireNavItem(href: string): NavItem {
  const item = findNavItem(href);
  if (!item || item.href !== href) throw new Error(`Route ${href} is not registered in NAVIGATION`);
  return item;
}
