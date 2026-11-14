import { queryOne } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import {
  addCogsVersion,
  addCost,
  addLead,
  addSale,
  cogsSchema,
  costSchema,
  eventSchema,
  leadSchema,
  saleSchema,
  saveEvent,
} from "@/lib/events/manage";

/**
 * DEMO events (Phase 5) — SYNTHETIC. Created through the same mutation
 * functions as the UI (validated + audited). Idempotent: an event whose name
 * already exists is skipped; COGS versions are upserts.
 *
 * Stories: Ramadan bazaar (profitable), UMKM exhibition (B2B leads + reseller
 * order after the event), fun-run sponsorship (loss), Car Free Day pop-up
 * (small but profitable), Halal Expo (strong, 45-day attribution), a planned
 * year-end bazaar. Madu Hutan COGS +8% from 1 Jul 2026.
 */

type Sale = [
  sku: string,
  soldOn: string,
  units: number,
  unitPrice: number,
  phase?: "event" | "pasca_event",
  note?: string,
];
type Cost = [category: string, costType: "tetap" | "variabel", amount: number, note?: string];
type Lead = [capturedOn: string, source: string, leads: number, converted: number];

type DemoEvent = {
  name: string;
  kind: string;
  location: string;
  start: string;
  end: string;
  status: string;
  attribution: number;
  notes?: string;
  sales: Sale[];
  costs: Cost[];
  /** Venue/marketplace commission as a share of revenue (variable cost). */
  commission?: number;
  leads: Lead[];
};

const EVENTS: DemoEvent[] = [
  {
    name: "Bazar Ramadan Mall Kota (DEMO)",
    kind: "bazar",
    location: "Jakarta",
    start: "2026-02-26",
    end: "2026-03-08",
    status: "selesai",
    attribution: 30,
    sales: [
      ["MU-HUTAN-500", "2026-03-01", 140, 150_000],
      ["MU-HUTAN-250", "2026-03-01", 90, 85_000],
      ["MU-PKT-KLG-01", "2026-03-05", 45, 300_000],
      ["MU-KLG-500", "2026-03-03", 40, 145_000],
      ["MU-PRO-30", "2026-03-06", 60, 70_000],
      ["MU-HUTAN-500", "2026-03-20", 25, 160_000, "pasca_event", "Pesanan ulang via WhatsApp"],
      ["MU-PKT-KLG-01", "2026-03-18", 8, 310_000, "pasca_event", "Parsel Lebaran"],
    ],
    costs: [
      ["sewa_booth", "tetap", 9_500_000, "Booth 3×3 m, 11 hari"],
      ["tenaga_kerja", "tetap", 4_400_000, "2 SPG × 11 hari"],
      ["transport", "tetap", 1_200_000],
      ["perlengkapan", "tetap", 1_500_000, "Dekorasi & display"],
      ["sampel", "variabel", 800_000, "Tester madu"],
    ],
    commission: 0.08,
    leads: [
      ["2026-03-01", "form", 180, 22],
      ["2026-03-06", "whatsapp", 95, 18],
    ],
  },
  {
    name: "Pameran UMKM Nusantara (DEMO)",
    kind: "pameran",
    location: "JCC Senayan",
    start: "2026-05-14",
    end: "2026-05-17",
    status: "selesai",
    attribution: 30,
    notes: "Banyak calon reseller; pesanan reseller datang setelah pameran.",
    sales: [
      ["MU-HUTAN-500", "2026-05-15", 60, 150_000],
      ["MU-KLC-150", "2026-05-15", 45, 120_000],
      ["MU-RANDU-500", "2026-05-16", 30, 100_000],
      ["MU-HUTAN-1000", "2026-05-16", 12, 280_000],
      ["MU-HUTAN-500", "2026-06-05", 120, 120_000, "pasca_event", "Order reseller (harga grosir)"],
      ["MU-KLC-150", "2026-06-10", 40, 98_000, "pasca_event", "Order reseller (harga grosir)"],
    ],
    costs: [
      ["sewa_booth", "tetap", 7_500_000],
      ["tenaga_kerja", "tetap", 1_600_000, "2 SPG × 4 hari"],
      ["transport", "tetap", 900_000],
      ["promosi", "tetap", 1_000_000, "Brosur & katalog reseller"],
      ["sampel", "variabel", 450_000],
    ],
    leads: [
      ["2026-05-15", "kartu_nama", 64, 9],
      ["2026-05-16", "qr", 140, 12],
    ],
  },
  {
    name: "Sponsorship Lomba Lari 10K (DEMO)",
    kind: "sponsorship",
    location: "Bogor",
    start: "2026-07-19",
    end: "2026-07-19",
    status: "selesai",
    attribution: 30,
    notes: "Brand awareness; biaya sponsor besar, penjualan langsung kecil.",
    sales: [
      ["MU-HUTAN-250", "2026-07-19", 70, 80_000],
      ["MU-KLC-150", "2026-07-19", 25, 115_000],
      ["MU-HUTAN-250", "2026-08-02", 30, 85_000, "pasca_event"],
    ],
    costs: [
      ["promosi", "tetap", 25_000_000, "Paket sponsor gold"],
      ["sampel", "variabel", 3_200_000, "Madu sachet untuk 1.600 pelari"],
      ["tenaga_kerja", "tetap", 600_000],
      ["transport", "tetap", 500_000],
    ],
    leads: [["2026-07-19", "qr", 420, 15]],
  },
  {
    name: "Pop-up Car Free Day (DEMO)",
    kind: "pop_up",
    location: "Jl. Sudirman",
    start: "2026-08-09",
    end: "2026-08-09",
    status: "selesai",
    attribution: 14,
    sales: [
      ["MU-HUTAN-250", "2026-08-09", 38, 85_000],
      ["MU-HUTAN-500", "2026-08-09", 22, 155_000],
      ["MU-KLC-150", "2026-08-09", 18, 120_000],
    ],
    costs: [
      ["perlengkapan", "tetap", 450_000, "Tenda & meja"],
      ["tenaga_kerja", "tetap", 300_000],
      ["transport", "tetap", 200_000],
    ],
    leads: [["2026-08-09", "whatsapp", 46, 11]],
  },
  {
    name: "Halal Expo Indonesia 2026 (DEMO)",
    kind: "pameran",
    location: "ICE BSD",
    start: "2026-10-08",
    end: "2026-10-11",
    status: "selesai",
    attribution: 45,
    sales: [
      ["MU-HUTAN-500", "2026-10-09", 160, 150_000],
      ["MU-PKT-KLG-01", "2026-10-10", 55, 300_000],
      ["MU-KLG-500", "2026-10-10", 50, 145_000],
      ["MU-KLC-150", "2026-10-11", 70, 120_000],
      ["MU-PRO-30", "2026-10-11", 80, 70_000],
      ["MU-HUTAN-500", "2026-10-30", 60, 155_000, "pasca_event"],
      ["MU-PKT-KLG-01", "2026-11-05", 20, 310_000, "pasca_event", "Pesanan korporat"],
    ],
    costs: [
      ["sewa_booth", "tetap", 14_000_000, "Booth 3×6 m"],
      ["tenaga_kerja", "tetap", 2_400_000, "3 SPG × 4 hari"],
      ["akomodasi", "tetap", 1_800_000],
      ["transport", "tetap", 1_300_000],
      ["promosi", "tetap", 2_000_000, "Iklan katalog expo"],
      ["sampel", "variabel", 900_000],
    ],
    commission: 0.05,
    leads: [
      ["2026-10-09", "form", 260, 31],
      ["2026-10-10", "kartu_nama", 85, 14],
    ],
  },
  {
    name: "Bazar Akhir Tahun 2026 (DEMO)",
    kind: "bazar",
    location: "Bandung",
    start: "2026-12-12",
    end: "2026-12-14",
    status: "rencana",
    attribution: 30,
    sales: [],
    costs: [["sewa_booth", "tetap", 6_000_000, "DP booth sudah dibayar"]],
    leads: [],
  },
];

const COGS_VERSIONS: [sku: string, from: string, cogs: number, note: string][] = [
  ["MU-HUTAN-250", "2026-07-01", 41_000, "Kenaikan harga madu hutan +8% (DEMO)"],
  ["MU-HUTAN-500", "2026-07-01", 73_500, "Kenaikan harga madu hutan +8% (DEMO)"],
  ["MU-HUTAN-1000", "2026-07-01", 134_000, "Kenaikan harga madu hutan +8% (DEMO)"],
];

const s = String;

export async function seedDemoEvents(session: ActiveSession): Promise<number> {
  for (const [sku, from, cogs, note] of COGS_VERSIONS) {
    const res = await addCogsVersion(session, cogsSchema.parse({ sku, effectiveFrom: from, unitCogs: s(cogs), note }));
    if (!res.ok) throw new Error(`COGS DEMO ${sku}: ${res.message}`);
  }
  let created = 0;
  for (const e of EVENTS) {
    const exists = await queryOne("SELECT id FROM events WHERE organization_id = ? AND name = ?", [
      session.organization.id,
      e.name,
    ]);
    if (exists) continue;
    const ev = await saveEvent(
      session,
      eventSchema.parse({
        name: e.name,
        kind: e.kind,
        location: e.location,
        startDate: e.start,
        endDate: e.end,
        status: e.status,
        attributionDays: s(e.attribution),
        notes: e.notes ?? "",
      }),
      { isDemo: true },
    );
    if (!ev.ok) throw new Error(`Event DEMO ${e.name} gagal dibuat`);
    let revenue = 0;
    for (const [sku, soldOn, units, price, phase = "event", note = ""] of e.sales) {
      revenue += units * price;
      const res = await addSale(
        session,
        ev.id,
        saleSchema.parse({ sku, soldOn, units: s(units), revenue: s(units * price), phase, note }),
      );
      if (!res.ok) throw new Error(`Penjualan DEMO ${e.name}: ${res.message}`);
    }
    const costs: Cost[] = [...e.costs];
    if (e.commission) {
      costs.push([
        "lainnya",
        "variabel",
        Math.round(revenue * e.commission),
        `Komisi pengelola ${e.commission * 100}%`,
      ]);
    }
    for (const [category, costType, amount, note = ""] of costs) {
      await addCost(session, ev.id, costSchema.parse({ category, costType, amount: s(amount), incurredOn: "", note }));
    }
    for (const [capturedOn, source, leads, converted] of e.leads) {
      await addLead(
        session,
        ev.id,
        leadSchema.parse({ capturedOn, source, leads: s(leads), converted: s(converted), note: "" }),
      );
    }
    created++;
  }
  return created;
}
