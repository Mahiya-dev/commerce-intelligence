import { describe, expect, it } from "vitest";
import { addDays, daysBetween, isIsoDate, MAX_RANGE_DAYS, resolveRange } from "@/lib/ecommerce/date-range";

const AS_OF = "2026-11-10";

describe("date helpers", () => {
  it("validates calendar dates and counts inclusive days", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-11-1")).toBe(false);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-11-01", "2026-11-10")).toBe(10);
  });
});

describe("resolveRange", () => {
  it("defaults to month-to-date with the equivalent period of last month", () => {
    expect(resolveRange({}, AS_OF)).toEqual({
      preset: "mtd",
      from: "2026-11-01",
      to: "2026-11-10",
      days: 10,
      compare: { from: "2026-10-01", to: "2026-10-10" },
    });
  });

  it("caps the MoM comparison at the length of last month", () => {
    expect(resolveRange({ range: "mtd" }, "2026-03-31").compare).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it.each([
    ["7d", "2026-11-04", 7, { from: "2026-10-28", to: "2026-11-03" }],
    ["30d", "2026-10-12", 30, { from: "2026-09-12", to: "2026-10-11" }],
    ["90d", "2026-08-13", 90, { from: "2026-05-15", to: "2026-08-12" }],
  ])("%s ends on the as-of date and compares with the preceding period", (range, from, days, compare) => {
    expect(resolveRange({ range }, AS_OF)).toMatchObject({ from, to: AS_OF, days, compare });
  });

  it("last month compares with the full month before it", () => {
    expect(resolveRange({ range: "last_month" }, AS_OF)).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-31",
      days: 31,
      compare: { from: "2026-09-01", to: "2026-09-30" },
    });
  });

  it("custom range, also when only dates are given (shared link)", () => {
    const expected = {
      preset: "custom",
      from: "2026-09-15",
      to: "2026-10-14",
      days: 30,
      compare: { from: "2026-08-16", to: "2026-09-14" },
    };
    expect(resolveRange({ range: "custom", from: "2026-09-15", to: "2026-10-14" }, AS_OF)).toEqual(expected);
    expect(resolveRange({ from: "2026-09-15", to: "2026-10-14" }, AS_OF)).toEqual(expected);
  });

  it.each([
    [{ range: "custom", from: "2026-10-14", to: "2026-09-15" }, /setelah/],
    [{ range: "custom", from: "2026-02-30", to: "2026-03-01" }, /tidak valid/],
    [{ range: "custom", from: "2025-01-01", to: "2026-11-01" }, new RegExp(String(MAX_RANGE_DAYS))],
    [{ range: "custom" }, /tidak valid/],
  ])("falls back to MTD with a message for %j", (input, message) => {
    const r = resolveRange(input, AS_OF);
    expect(r).toMatchObject({ preset: "mtd", from: "2026-11-01", to: AS_OF });
    expect(r.error).toMatch(message);
  });

  it("clips a custom range at the latest data so the comparison stays like-for-like", () => {
    expect(resolveRange({ range: "custom", from: "2026-11-01", to: "2026-11-30" }, AS_OF)).toEqual({
      preset: "custom",
      from: "2026-11-01",
      to: AS_OF,
      days: 10,
      compare: { from: "2026-10-22", to: "2026-10-31" },
      clippedTo: AS_OF,
    });
    expect(resolveRange({ range: "custom", from: "2026-11-11", to: "2026-11-30" }, AS_OF).error).toMatch(/Belum ada/);
  });

  it("ignores unknown presets", () => {
    expect(resolveRange({ range: "yesterday" }, AS_OF).preset).toBe("mtd");
  });
});
