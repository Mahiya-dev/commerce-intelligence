import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  consigned,
  idleStock,
  recommend,
  skuMetrics,
  warehouseStock,
  type Movement,
} from "@/lib/affiliates/allocation";
import { movementSchema } from "@/lib/affiliates/manage";
import { csvTables } from "@/lib/imports/sources";
import { validateTable } from "@/lib/imports/validate";

const mv = (p: Partial<Movement>): Movement => ({
  sku: "A",
  affiliateId: null,
  type: "masuk",
  quantity: 10,
  sign: 1,
  ...p,
});

describe("stock ledger", () => {
  const moves = [
    mv({ quantity: 100 }),
    mv({ type: "penyesuaian", quantity: 5, sign: -1 }),
    mv({ type: "alokasi", affiliateId: "x", quantity: 40 }),
    mv({ type: "retur", affiliateId: "x", quantity: 10 }),
  ];
  it("warehouse = in ± adjust − allocated + returned", () => {
    expect(warehouseStock(moves).get("A")).toBe(100 - 5 - 40 + 10);
  });
  it("consigned = allocated − returned per affiliate", () => {
    expect(consigned(moves).get("x|A")).toBe(30);
  });
});

describe("metrics and recommendations", () => {
  const m = (affiliateId: string, soldWindow: number, consignedQty: number, soldTotal = soldWindow) =>
    skuMetrics({ affiliateId, sku: "A", soldTotal, soldWindow, soldPeriod: soldWindow, consigned: consignedQty }, 14);

  it("locked, velocity, sell-through and cover", () => {
    const r = m("x", 28, 40);
    expect(r).toMatchObject({ locked: 12, velocity: 2, oversold: false });
    expect(r.sellThrough).toBeCloseTo(28 / 40);
    expect(r.daysOfCover).toBe(6);
    expect(m("y", 10, 5)).toMatchObject({ locked: 0, oversold: true });
  });

  it("proposes target − locked, fastest first, never above free stock", () => {
    const rows = [m("slow", 14, 14), m("fast", 42, 50)]; // velocity 1 and 3, locked 0 and 8
    const recs = recommend(rows, new Map([["A", 40]]), 14);
    expect(recs.map((r) => [r.affiliateId, r.target, r.need, r.quantity, r.capped])).toEqual([
      ["fast", 42, 34, 34, false],
      ["slow", 14, 14, 6, true],
    ]);
    expect(recs.reduce((s, r) => s + r.quantity, 0)).toBeLessThanOrEqual(40);
  });

  it("stock already promised to approved allocations is not offered again", () => {
    const recs = recommend([m("fast", 42, 0)], new Map([["A", 40]]), 14, new Map([["A", 30]]));
    expect(recs[0]).toMatchObject({ quantity: 10, capped: true });
  });

  it("flags idle stock", () => {
    expect(idleStock([m("idle", 0, 30, 5), m("ok", 28, 40)], 14).map((r) => r.affiliateId)).toEqual(["idle"]);
  });
});

describe("validation", () => {
  it("a return needs an affiliate", () => {
    const base = { sku: "A", type: "retur", quantity: "5", affiliateId: "", occurredOn: "2026-11-01", note: "" };
    expect(movementSchema.safeParse(base).success).toBe(false);
    expect(movementSchema.safeParse({ ...base, type: "masuk" }).success).toBe(true);
    expect(movementSchema.safeParse({ ...base, type: "masuk", quantity: "0" }).success).toBe(false);
  });

  it("the DEMO HSL file passes the import validator", () => {
    const path = "phase-5/csv/penjualan_hsl_DEMO.csv";
    const [t] = csvTables(path, readFileSync(join(process.cwd(), "samples", path)));
    const out = validateTable(t.table, { today: "2026-11-11", nameHint: path });
    if (!out.ok) throw new Error(out.message);
    expect(out.result.template.key).toBe("penjualan_hsl");
    expect(out.result.invalidRows).toBe(0);
  });
});
