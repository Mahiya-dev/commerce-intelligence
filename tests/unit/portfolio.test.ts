import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csvTables } from "@/lib/imports/sources";
import { validateTable } from "@/lib/imports/validate";
import {
  buildMatrix,
  monthPeriods,
  monthsUpTo,
  quadrantFor,
  quadrantHistory,
  recommend,
  ROAS_FLOOR,
  touchpointBreakdown,
  type SkuDailyFact,
  type TouchpointFact,
} from "@/lib/portfolio/portfolio";
import type { Touchpoint } from "@/lib/imports/templates";

const SAMPLES = join(process.cwd(), "samples");
const TODAY = "2026-11-11";
const AS_OF = "2026-11-10";
const DEFAULTS = { shareFactor: 1, growthThreshold: 0 };

function rows(path: string): Record<string, string>[] {
  const [t] = csvTables(path, readFileSync(join(SAMPLES, path)));
  const [header, ...data] = t.table;
  return data
    .filter((r) => r.some(Boolean))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.replace(/^﻿/, ""), r[i] ?? ""])));
}

/** DEMO facts per internal SKU, built from the CSVs the same way the read model does in SQL. */
function demoFacts() {
  const mapping = new Map(
    rows("phase-2/csv/master_listing_DEMO.csv").map((l) => [
      `${l.id_produk_channel}|${l.id_sku_channel}`,
      { sku: l.sku_internal, units: Number(l.isi_per_listing) },
    ]),
  );
  const product = [
    ...rows("phase-3/csv/kinerja_produk_harian_HISTORI_DEMO.csv"),
    ...rows("phase-2/csv/kinerja_produk_harian_DEMO.csv"),
  ];
  const agg = new Map<string, SkuDailyFact>();
  for (const r of product) {
    const m = mapping.get(`${r.id_produk_channel}|${r.id_sku_channel}`)!;
    if (!m.sku) continue;
    const key = `${m.sku}|${r.tanggal}`;
    const a = agg.get(key) ?? { sku: m.sku, date: r.tanggal, gmv: 0, orders: 0, units: 0, visitors: 0, clicks: 0 };
    a.gmv += Number(r.gmv);
    a.orders += Number(r.pesanan);
    a.units += Number(r.unit_terjual) * m.units;
    a.visitors! += Number(r.pengunjung_produk || 0);
    a.clicks! += Number(r.klik_produk || 0);
    agg.set(key, a);
  }
  const tp: TouchpointFact[] = rows("phase-3/csv/kinerja_touchpoint_DEMO.csv").flatMap((r) => {
    const m = mapping.get(`${r.id_produk_channel}|${r.id_sku_channel}`)!;
    return m.sku
      ? [
          {
            sku: m.sku,
            touchpoint: r.touchpoint as Touchpoint,
            date: r.tanggal,
            gmv: Number(r.gmv),
            orders: Number(r.pesanan),
            cost: r.biaya === "" ? null : Number(r.biaya),
          },
        ]
      : [];
  });
  return { skuFacts: [...agg.values()], tp };
}

describe("Phase 3 DEMO samples pass the import validator", () => {
  it.each([
    ["phase-3/csv/kinerja_toko_harian_HISTORI_DEMO.csv", "kinerja_toko_harian", 819],
    ["phase-3/csv/kinerja_produk_harian_HISTORI_DEMO.csv", "kinerja_produk_harian", 2730],
    ["phase-3/csv/kinerja_touchpoint_DEMO.csv", "kinerja_touchpoint", 13447],
  ])("%s", (path, key, minRows) => {
    const [t] = csvTables(path, readFileSync(join(SAMPLES, path)));
    const out = validateTable(t.table, { today: TODAY, nameHint: path });
    if (!out.ok) throw new Error(out.message);
    expect(out.result.template.key).toBe(key);
    expect(out.result.invalidRows).toBe(0);
    expect(out.result.totalRows).toBeGreaterThanOrEqual(minRows);
  });

  it("rejects an unknown touchpoint", () => {
    const out = validateTable(
      [
        ["tanggal", "channel", "id_produk_channel", "nama_listing", "touchpoint", "gmv", "pesanan", "unit_terjual"],
        ["2026-11-01", "shopee", "P1", "X", "tv", "100", "1", "1"],
      ],
      { today: TODAY },
    );
    expect(out.ok && out.result.rows[0].issues.map((i) => i.code)).toEqual(["unknown_touchpoint"]);
  });
});

describe("periods and quadrants", () => {
  it("the current month compares days 1..N; past months compare full months", () => {
    expect(monthPeriods("2026-11", AS_OF)).toEqual({
      period: { from: "2026-11-01", to: "2026-11-10" },
      compare: { from: "2026-10-01", to: "2026-10-10" },
      isPartial: true,
    });
    expect(monthPeriods("2026-03", AS_OF)).toEqual({
      period: { from: "2026-03-01", to: "2026-03-31" },
      compare: { from: "2026-02-01", to: "2026-02-28" },
      isPartial: false,
    });
    expect(monthsUpTo(AS_OF, 3)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });

  it.each([
    [0.3, 0.1, "bintang"],
    [0.3, -0.1, "penopang"],
    [0.05, 0.1, "potensial"],
    [0.05, -0.1, "evaluasi"],
    [0.05, null, "baru"],
    [0.2, 0, "bintang"], // thresholds are inclusive
  ] as const)("share %d, growth %d → %s", (share, growth, quadrant) => {
    expect(quadrantFor(share, growth, 0.2, 0)).toBe(quadrant);
  });

  it("shares are relative to SKUs active in the month; a SKU new this month is 'baru'", () => {
    const f = (sku: string, date: string, gmv: number): SkuDailyFact => ({
      sku,
      date,
      gmv,
      orders: 1,
      units: 1,
      visitors: null,
      clicks: null,
    });
    const facts = [
      f("A", "2026-09-05", 100),
      f("B", "2026-09-05", 100),
      f("A", "2026-10-05", 300),
      f("B", "2026-10-05", 50),
      f("C", "2026-10-05", 150),
    ];
    const m = buildMatrix(facts, "2026-10", AS_OF, DEFAULTS);
    expect(m.activeSkus).toBe(3);
    expect(m.shareThreshold).toBeCloseTo(1 / 3);
    expect(Object.fromEntries(m.rows.map((r) => [r.sku, r.quadrant]))).toEqual({
      A: "bintang",
      C: "baru",
      B: "evaluasi",
    });
    expect(m.rows[0].current.visitors).toBeNull(); // missing stays missing
    expect(buildMatrix(facts, "2026-10", AS_OF, { shareFactor: 2, growthThreshold: 0 }).rows[0].quadrant).toBe(
      "potensial",
    );
  });
});

describe("DEMO portfolio stories", () => {
  const { skuFacts, tp } = demoFacts();
  const months = monthsUpTo(AS_OF, 12);
  const history = quadrantHistory(skuFacts, months, AS_OF, DEFAULTS);
  const q = (sku: string, month: string) => history.bySku.get(sku)![months.indexOf(month)];

  it("covers 12 months with 6 mapped SKUs", () => {
    expect(months[0]).toBe("2025-12");
    expect(history.matrices.every((m) => m.activeSkus === 6)).toBe(true);
  });

  it("matches the intended stories", () => {
    expect(q("MU-HUTAN-500", "2026-10")).toMatch(/bintang|penopang/); // large and steady
    expect(q("MU-HUTAN-250", "2026-01")).toBe("penopang"); // large but shrinking…
    expect(q("MU-HUTAN-250", "2026-08")).toBe("evaluasi"); // …until its share drops
    expect(q("MU-KLC-150", "2026-01")).toBe("potensial"); // small, growing fast
    expect(q("MU-RANDU-500", "2026-06")).toBe("evaluasi"); // declining
    expect(q("MU-PKT-KLG-01", "2026-02")).toMatch(/potensial|bintang/); // Ramadan spike
    expect(q("MU-PKT-KLG-01", "2026-04")).toBe("evaluasi"); // after Lebaran
  });

  it("recommends the right fixes for Madu Randu (weak ads)", () => {
    const m = history.matrices[months.indexOf("2026-10")];
    const row = m.rows.find((r) => r.sku === "MU-RANDU-500")!;
    const tps = touchpointBreakdown(
      tp.filter((t) => t.sku === "MU-RANDU-500"),
      m.period,
      m.compare,
    );
    const iklan = tps.find((t) => t.touchpoint === "iklan")!;
    expect(iklan.roas!).toBeLessThan(ROAS_FLOOR);
    const recs = recommend(row, tps, q("MU-RANDU-500", "2026-09"));
    expect(recs.map((r) => r.title)).toContain("Biaya Iklan hampir tidak kembali");
    expect(recs[0].title).toMatch(/^Evaluasi/);
  });

  it("touchpoint totals reconcile with SKU GMV", () => {
    const m = history.matrices[months.indexOf("2026-10")];
    for (const row of m.rows) {
      const tps = touchpointBreakdown(
        tp.filter((t) => t.sku === row.sku),
        m.period,
        m.compare,
      );
      expect(tps.reduce((s, t) => s + t.gmv, 0)).toBe(row.current.gmv);
    }
  });

  it("prints the DEMO matrix (debug aid)", () => {
    for (const m of history.matrices) {
      if (process.env.PRINT_MATRIX) console.log(m.month, m.rows.map((r) => `${r.sku}:${r.quadrant}`).join(" "));
    }
  });
});
