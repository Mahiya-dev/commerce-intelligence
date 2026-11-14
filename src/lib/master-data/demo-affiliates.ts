import { readFileSync } from "node:fs";
import { join } from "node:path";
import { queryOne } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { csvTables } from "@/lib/imports/sources";
import {
  applyAllocation,
  approveAllocation,
  movementSchema,
  proposeAllocations,
  recordMovement,
} from "@/lib/affiliates/manage";

/**
 * DEMO stock ledger for the HSL affiliates (Phase 5) — SYNTHETIC.
 * Warehouse receipts, then every historical allocation replayed through the
 * real workflow (propose → approve → apply) so the DEMO exercises it.
 * Idempotent: skipped when the organization already has stock movements.
 * Run after penjualan_hsl_DEMO.csv was imported (affiliates exist).
 */
export const DEMO_STOCK_RECEIPTS = "phase-5/csv/stok_masuk_DEMO.csv";
export const DEMO_ALLOCATIONS = "phase-5/csv/alokasi_hsl_DEMO.csv";

function rows(samplesDir: string, path: string): Record<string, string>[] {
  const [t] = csvTables(path, readFileSync(join(samplesDir, path)));
  const [header, ...data] = t.table;
  const names = header.map((h) => h.replace(/^﻿/, ""));
  return data.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(names.map((h, i) => [h, r[i] ?? ""])));
}

export async function seedDemoAffiliates(session: ActiveSession, samplesDir: string): Promise<number> {
  const org = session.organization.id;
  const any = await queryOne("SELECT id FROM inventory_movements WHERE organization_id = ? LIMIT 1", [org]);
  if (any) return 0;

  for (const r of rows(samplesDir, DEMO_STOCK_RECEIPTS)) {
    const res = await recordMovement(
      session,
      movementSchema.parse({
        sku: r.sku,
        type: "masuk",
        quantity: r.jumlah,
        affiliateId: "",
        occurredOn: r.tanggal,
        note: r.catatan,
      }),
      { isDemo: true },
    );
    if (!res.ok) throw new Error(`Stok DEMO ${r.sku}: ${res.message}`);
  }

  const allocations = rows(samplesDir, DEMO_ALLOCATIONS).sort((a, b) => (a.tanggal < b.tanggal ? -1 : 1));
  for (const a of allocations) {
    const aff = await queryOne<{ id: string }>("SELECT id FROM affiliates WHERE organization_id = ? AND username = ?", [
      org,
      a.username,
    ]);
    if (!aff) throw new Error(`Afiliasi DEMO @${a.username} belum ada — impor penjualan HSL dulu.`);
    const qty = Number(a.jumlah);
    await proposeAllocations(session, [{ affiliateId: aff.id, sku: a.sku, quantity: qty, basis: { demo: true } }], {
      isDemo: true,
    });
    const proposal = await queryOne<{ id: string }>(
      `SELECT a.id FROM hsl_allocations a JOIN product_variants v ON v.organization_id = a.organization_id AND v.id = a.variant_id
        WHERE a.organization_id = ? AND a.affiliate_id = ? AND v.sku = ? AND a.status = 'diusulkan'`,
      [org, aff.id, a.sku],
    );
    if (!proposal) throw new Error("Usulan DEMO tidak tersimpan.");
    const approved = await approveAllocation(session, proposal.id, qty);
    if (!approved.ok) throw new Error(`Alokasi DEMO @${a.username} ${a.sku}: ${approved.message}`);
    const applied = await applyAllocation(session, proposal.id, { occurredOn: a.tanggal });
    if (!applied.ok) throw new Error(`Alokasi DEMO @${a.username} ${a.sku}: ${applied.message}`);
  }
  return allocations.length;
}
