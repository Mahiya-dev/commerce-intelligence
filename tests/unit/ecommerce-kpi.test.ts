import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csvTables } from "@/lib/imports/sources";
import { validateTable } from "@/lib/imports/validate";
import {
  addMonths,
  cumulativeVsTarget,
  dailyGmvSeries,
  dateRange,
  daysInMonth,
  incompleteChannels,
  momEquivalent,
  monthlySummary,
  statusFor,
  targetProgress,
  targetScorecard,
  type DailyFact,
} from "@/lib/ecommerce/kpi";

/**
 * Every expected number below comes from samples/phase-2/expected.json, the
 * machine-readable copy of the "Kunci Jawaban" sheet (independently verified
 * against Python, see samples/phase-2/README.md).
 */
const SAMPLES = join(process.cwd(), "samples/phase-2");
const expected = JSON.parse(readFileSync(join(SAMPLES, "expected.json"), "utf8")).expected;
const CHANNELS = ["shopee", "tiktok_shop", "tokopedia"];
const AS_OF = "2026-11-10";

function rows(file: string) {
  const [t] = csvTables(file, readFileSync(join(SAMPLES, "csv", file)));
  const out = validateTable(t.table, { today: "2026-11-11" });
  if (!out.ok) throw new Error(out.message);
  return out.result.rows.map((r) => r.normalized);
}

const facts: DailyFact[] = rows("kinerja_toko_harian_DEMO.csv").map((r) => ({
  channel: r.channel as string,
  date: r.tanggal as string,
  gmv: r.gmv as number,
  orders: r.pesanan as number,
  units: r.unit_terjual as number,
  visitors: r.pengunjung as number,
}));
const targets = rows("target_bulanan_DEMO.csv")
  .filter((r) => r.bulan === "2026-11")
  .map((r) => ({ channel: r.channel as string, targetGmv: r.target_gmv as number }));

const MONTH_LABELS = ["Sep 2026", "Okt 2026", "Nov 2026 (MTD)"];

describe("calendar helpers", () => {
  it("handles month lengths and offsets", () => {
    expect(daysInMonth("2026-11-10")).toBe(30);
    expect(daysInMonth("2028-02-01")).toBe(29);
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
    expect(addMonths("2026-11-10", -2)).toBe("2026-09-01");
  });
});

describe("KPIs vs Kunci Jawaban (expected.json)", () => {
  it("§1 monthly summary: days, GMV, orders, AOV, conversion rate", () => {
    const months = monthlySummary(facts, CHANNELS, AS_OF, 3);
    expect(months.map((m) => m.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(months.map((m) => m.isPartial)).toEqual([false, false, true]);
    months.forEach((m, i) => {
      const cells = [...m.rows.map((r) => [r.channel, r.totals] as const), ["SEMUA", m.all] as const];
      for (const [channel, t] of cells) {
        const e = expected.sec1[`${MONTH_LABELS[i]}|${channel}`];
        expect(t.days, `${MONTH_LABELS[i]} ${channel} days`).toBe(e.F);
        expect(t.gmv, `${MONTH_LABELS[i]} ${channel} gmv`).toBe(e.H);
        expect(t.orders).toBe(e.I);
        expect(t.aov).toBeCloseTo(e.J, 6);
        expect(t.conversionRate).toBeCloseTo(e.M, 12);
      }
    });
  });

  it("§2 equivalent-period MoM (1–10 Nov vs 1–10 Okt)", () => {
    const mom = momEquivalent(facts, CHANNELS, AS_OF);
    expect(mom.previous).toEqual({ from: "2026-10-01", to: "2026-10-10" });
    for (const r of [...mom.rows, mom.all]) {
      const e = expected.sec2[r.channel ?? "SEMUA"];
      expect(r.current.gmv).toBe(e.B);
      expect(r.previous.gmv).toBe(e.C);
      expect(r.gmvChange).toBeCloseTo(e.D, 12);
    }
  });

  it("§3 target progress, status, run rate and forecast", () => {
    const card = targetScorecard(facts, targets, CHANNELS, AS_OF);
    const label = { on_track: "On Track", watch: "Watch", at_risk: "At Risk" };
    for (const { channel, result } of [...card.rows, { channel: "SEMUA", result: card.all }]) {
      const e = expected.sec3[channel];
      expect(result, channel).not.toBeNull();
      expect(result!.target).toBe(e.B);
      expect(result!.actual).toBe(e.C);
      expect(result!.progress).toBeCloseTo(e.E, 12);
      expect(label[result!.status!]).toBe(e.F);
      expect(result!.runRateNeeded).toBeCloseTo(e.I, 6);
      expect(result!.forecast).toBeCloseTo(e.J, 4);
    }
    expect(card.channelsWithoutTarget).toEqual([]);
  });

  it("flags the deliberately incomplete channel-days", () => {
    // Okt Tokopedia has 30 of 31 days in the DEMO data; November is complete up to the 10th.
    expect(incompleteChannels(facts, CHANNELS, AS_OF)).toEqual([]);
    expect(incompleteChannels(facts, CHANNELS, "2026-10-31")).toEqual([
      { channel: "tokopedia", days: 30, missingDays: 1 },
    ]);
  });
});

describe("edge cases", () => {
  it("never turns a zero denominator into 0", () => {
    const m = momEquivalent([], CHANNELS, AS_OF);
    expect(m.all.current.aov).toBeNull();
    expect(m.all.gmvChange).toBeNull();
    expect(statusFor(null)).toBeNull();
  });

  it("excludes channels without a target from the all-channel progress", () => {
    const card = targetScorecard(facts, [{ channel: "shopee", targetGmv: 345_000_000 }], CHANNELS, AS_OF);
    expect(card.all?.target).toBe(345_000_000);
    expect(card.all?.actual).toBe(expected.sec3.shopee.C);
    expect(card.channelsWithoutTarget).toEqual(["tiktok_shop", "tokopedia"]);
  });

  it("needs no run rate on the last day and when the target is already met", () => {
    expect(targetProgress(100, 50, "2026-11-30").runRateNeeded).toBe(0);
    expect(targetProgress(100, 150, "2026-11-10").runRateNeeded).toBe(0);
  });

  it("caps the previous period at the end of a shorter month", () => {
    expect(momEquivalent([], CHANNELS, "2026-03-31").previous).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("chart series", () => {
  it("lists every date in a range, across month ends", () => {
    expect(dateRange("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("daily GMV per channel keeps missing days as null, not zero", () => {
    const series = dailyGmvSeries(facts, CHANNELS, "2026-10-01", AS_OF);
    expect(series.map((s) => s.channel)).toEqual(CHANNELS);
    expect(series[0].points).toHaveLength(41);
    const sum = (ch: number) =>
      series[ch].points.filter((p) => p.date >= "2026-11-01").reduce((s, p) => s + (p.value ?? 0), 0);
    expect(sum(0)).toBe(110481400);
    const gapped = dailyGmvSeries(
      facts.filter((f) => !(f.channel === "shopee" && f.date === "2026-11-05")),
      CHANNELS,
      "2026-11-01",
      AS_OF,
    );
    expect(gapped[0].points.find((p) => p.date === "2026-11-05")?.value).toBeNull();
  });

  it("cumulative GMV ends at the scorecard actual and the pace reaches the full target", () => {
    const c = cumulativeVsTarget(facts, targets, AS_OF)!;
    const card = targetScorecard(facts, targets, CHANNELS, AS_OF).all!;
    expect(c).toHaveLength(30);
    expect(c[9]).toMatchObject({ date: AS_OF, actual: card.actual });
    expect(c[9].pace).toBeCloseTo(card.expected, 6);
    expect(c[10].actual).toBeNull();
    expect(c[29].pace).toBeCloseTo(card.target, 6);
    expect(cumulativeVsTarget(facts, [], AS_OF)).toBeNull();
  });
});
