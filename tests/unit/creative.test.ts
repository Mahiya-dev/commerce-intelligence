import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csvTables } from "@/lib/imports/sources";
import { validateTable } from "@/lib/imports/validate";
import {
  adMetrics,
  fatigue,
  groupBy,
  isWinner,
  parseAdName,
  WINNER_MIN_SPEND,
  type AdDailyFact,
} from "@/lib/creative/creative";
import { assetSchema, classificationSchema } from "@/lib/creative/manage";

const SAMPLES = join(process.cwd(), "samples");

describe("parseAdName", () => {
  it("parses the full convention", () => {
    expect(parseAdName("HUTAN500_TESTIMONI_KESEHATAN_VIF_B03_V2")).toEqual({
      product: "HUTAN500",
      hook: "TESTIMONI",
      angle: "KESEHATAN",
      format: "video_in_frame",
      batch: "B03",
      version: "V2",
      status: "ok",
    });
    expect(parseAdName("klc150_promo_hemat_mi_b05_v1").format).toBe("motion_image");
  });

  it("reports partial and failed names", () => {
    const partial = parseAdName("HUTAN500_TESTIMONI_VIF_B05");
    expect(partial).toMatchObject({
      product: "HUTAN500",
      hook: "TESTIMONI",
      angle: null,
      format: "video_in_frame",
      status: "partial",
    });
    expect(parseAdName("Iklan Promo Gajian Oktober Madu Hutan").status).toBe("failed");
  });
});

const fact = (day: number, p: Partial<AdDailyFact> = {}): AdDailyFact => ({
  adId: "1",
  date: `2026-10-${String(day).padStart(2, "0")}`,
  spend: 100_000,
  impressions: 10_000,
  reach: 8_000,
  clicks: 150,
  purchases: 3,
  revenue: 300_000,
  ...p,
});

describe("metrics", () => {
  it("computes CTR, CPC, CPM, CPA, ROAS; missing reach stays unknown", () => {
    const m = adMetrics([fact(1), fact(2)]);
    expect(m).toMatchObject({ spend: 200_000, ctr: 0.015, cpm: 10_000, roas: 3, days: 2 });
    expect(m.cpc).toBeCloseTo(666.67, 1);
    expect(m.cpa).toBeCloseTo(33_333.33, 1);
    expect(adMetrics([fact(1, { reach: null })]).frequency).toBeNull();
    expect(adMetrics([]).roas).toBeNull();
  });

  it("winners need spend, purchases and ROAS above the account", () => {
    const strong = adMetrics(Array.from({ length: 6 }, (_, i) => fact(i + 1)));
    expect(strong.spend).toBeGreaterThanOrEqual(WINNER_MIN_SPEND);
    expect(isWinner(strong, 2)).toBe(true);
    expect(isWinner(strong, 2.6)).toBe(false); // 3 < 2.6 × 1.2
    expect(isWinner(adMetrics([fact(1)]), 1)).toBe(false); // not enough spend
  });
});

describe("fatigue", () => {
  const series = (ctrLate: number, reachLate: number) =>
    Array.from({ length: 21 }, (_, i) =>
      i < 14 ? fact(i + 1) : fact(i + 1, { clicks: Math.round(10_000 * ctrLate), reach: reachLate }),
    );

  it("needs 14 active days", () => {
    expect(fatigue([fact(1), fact(2)]).status).toBe("belum_cukup");
  });
  it("flags a CTR drop with high frequency as fatigued", () => {
    expect(fatigue(series(0.009, 3_000))).toMatchObject({ status: "lelah" });
  });
  it("a CTR drop without pressure is only a watch", () => {
    expect(fatigue(series(0.009, 8_000)).status).toBe("waspada");
    expect(fatigue(series(0.0125, 8_000)).status).toBe("waspada");
    expect(fatigue(series(0.015, 3_000)).status).toBe("sehat");
  });
});

describe("grouping and validation", () => {
  it("groups by classification; unclassified ads stay visible", () => {
    const classes = new Map([["1", { adId: "1", format: "video_in_frame" as const, hook: "A", angle: null }]]);
    const g = groupBy([fact(1), fact(2, { adId: "2" })], classes, "format");
    expect(g.map((x) => x.key).sort()).toEqual([null, "video_in_frame"].sort());
  });

  it("validates classification and asset input", () => {
    expect(
      classificationSchema.safeParse({ product: "x", hook: "", angle: "", format: "", batch: "3", version: "" })
        .success,
    ).toBe(false);
    expect(
      classificationSchema.parse({
        product: "hutan500",
        hook: "",
        angle: "",
        format: "motion_image",
        batch: "B3",
        version: "V1",
      }),
    ).toMatchObject({ product: "HUTAN500", hook: null, batch: "B3" });
    expect(
      assetSchema.safeParse({
        name: "Aset",
        format: "video",
        url: "http://x.test",
        thumbnailUrl: "",
        sku: "",
        notes: "",
      }).success,
    ).toBe(false);
    expect(
      assetSchema.safeParse({
        name: "Aset",
        format: "video",
        url: "javascript:alert(1)",
        thumbnailUrl: "",
        sku: "",
        notes: "",
      }).success,
    ).toBe(false);
  });

  it("the DEMO Meta file passes the import validator", () => {
    const path = "phase-4/csv/meta_ads_harian_DEMO.csv";
    const [t] = csvTables(path, readFileSync(join(SAMPLES, path)));
    const out = validateTable(t.table, { today: "2026-11-11", nameHint: path });
    if (!out.ok) throw new Error(out.message);
    expect(out.result.template.key).toBe("meta_ads_harian");
    expect(out.result.invalidRows).toBe(0);
    expect(out.result.totalRows).toBe(1360);
  });
});
