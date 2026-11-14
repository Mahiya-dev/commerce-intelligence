import { describe, expect, it } from "vitest";
import { isValidTimeZone, organizationSettingsSchema } from "@/lib/organization/settings";
import { statusFor, targetProgress } from "@/lib/ecommerce/kpi";
import { resolveRange } from "@/lib/ecommerce/date-range";

const base = {
  name: "Madu Uray",
  timezone: "Asia/Makassar",
  onTrackPct: "90",
  watchPct: "70",
  targetConversionPct: "",
  targetAov: "",
  defaultRange: "mtd",
  portfolioShareFactor: "1",
  portfolioGrowthPct: "0",
};
const parse = (patch: Partial<typeof base>) => organizationSettingsSchema.safeParse({ ...base, ...patch });
const errorsOf = (patch: Partial<typeof base>) => {
  const r = parse(patch);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("organizationSettingsSchema", () => {
  it("parses Indonesian number formats; empty optional fields stay null", () => {
    const r = parse({ onTrackPct: "92,5", watchPct: "75", targetConversionPct: "3,5", targetAov: "Rp 120.000" });
    expect(r.success && r.data).toEqual({
      name: "Madu Uray",
      timezone: "Asia/Makassar",
      onTrackPct: 92.5,
      watchPct: 75,
      targetConversionPct: 3.5,
      targetAov: 120000,
      defaultRange: "mtd",
      portfolioShareFactor: 1,
      portfolioGrowthPct: 0,
    });
    expect(parse({}).success && parse({}).data).toMatchObject({ targetConversionPct: null, targetAov: null });
  });

  it.each([
    [{ name: "x" }, "name"],
    [{ timezone: "Mars/Olympus" }, "timezone"],
    [{ onTrackPct: "" }, "onTrackPct"],
    [{ onTrackPct: "abc" }, "onTrackPct"],
    [{ watchPct: "95" }, "watchPct"],
    [{ watchPct: "90" }, "watchPct"],
    [{ targetConversionPct: "150" }, "targetConversionPct"],
    [{ targetAov: "0" }, "targetAov"],
    [{ targetAov: "12,5" }, "targetAov"],
    [{ defaultRange: "custom" }, "defaultRange"],
    [{ portfolioShareFactor: "0" }, "portfolioShareFactor"],
    [{ portfolioShareFactor: "" }, "portfolioShareFactor"],
    [{ portfolioGrowthPct: "-80" }, "portfolioGrowthPct"],
  ])("rejects %j", (patch, field) => {
    expect(errorsOf(patch)).toHaveProperty(field);
  });

  it("accepts a negative growth threshold and a decimal share factor", () => {
    const r = parse({ portfolioShareFactor: "1,5", portfolioGrowthPct: "-5" });
    expect(r.success && r.data).toMatchObject({ portfolioShareFactor: 1.5, portfolioGrowthPct: -5 });
  });

  it("validates IANA timezones", () => {
    expect(isValidTimeZone("Asia/Jayapura")).toBe(true);
    expect(isValidTimeZone("WIB")).toBe(false);
  });
});

describe("configurable KPI settings", () => {
  it("target status uses the organization's thresholds", () => {
    expect(statusFor(0.85)).toBe("watch");
    expect(statusFor(0.85, { onTrack: 0.8, watch: 0.6 })).toBe("on_track");
    expect(statusFor(0.65, { onTrack: 0.95, watch: 0.75 })).toBe("at_risk");
    expect(targetProgress(300, 85, "2026-11-30", { onTrack: 0.8, watch: 0.5 }).status).toBe("at_risk");
    expect(targetProgress(300, 255, "2026-11-30", { onTrack: 0.8, watch: 0.5 }).status).toBe("on_track");
  });

  it("the default range applies when no range is requested and on invalid input", () => {
    expect(resolveRange({}, "2026-11-10", "30d")).toMatchObject({ preset: "30d", from: "2026-10-12" });
    const bad = resolveRange({ range: "custom", from: "x", to: "y" }, "2026-11-10", "7d");
    expect(bad).toMatchObject({ preset: "7d", from: "2026-11-04" });
    expect(bad.error).toMatch(/7 hari terakhir/);
    expect(resolveRange({ range: "mtd" }, "2026-11-10", "30d").preset).toBe("mtd");
  });
});
