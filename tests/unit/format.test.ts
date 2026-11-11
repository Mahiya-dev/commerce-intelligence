import { describe, expect, it } from "vitest";
import { formatDate, formatIDR, formatNumber, formatPercent, MISSING } from "@/lib/format";

// Intl output uses non-breaking spaces; normalise for readable assertions.
const n = (s: string) => s.replace(/ | /g, " ");

describe("format (id-ID)", () => {
  it("never renders missing values as zero", () => {
    expect(formatIDR(null)).toBe(MISSING);
    expect(formatIDR(undefined)).toBe(MISSING);
    expect(formatIDR(Number.NaN)).toBe(MISSING);
    expect(formatNumber(null)).toBe(MISSING);
    expect(formatPercent(undefined)).toBe(MISSING);
    expect(formatDate(null)).toBe(MISSING);
    expect(formatDate("not-a-date")).toBe(MISSING);
  });

  it("still renders a real zero as zero", () => {
    expect(n(formatIDR(0))).toBe("Rp 0");
    expect(formatNumber(0)).toBe("0");
  });

  it("formats rupiah with Indonesian grouping", () => {
    expect(n(formatIDR(1250000))).toBe("Rp 1.250.000");
  });

  it("formats compact rupiah", () => {
    expect(formatIDR(1_500_000, { compact: true })).toBe("Rp1,5 jt");
    expect(formatIDR(2_300_000_000, { compact: true })).toBe("Rp2,3 M");
    expect(formatIDR(-45_000, { compact: true })).toBe("-Rp45 rb");
  });

  it("formats percent from a ratio with comma decimals", () => {
    expect(n(formatPercent(0.153))).toBe("15,3%");
  });

  it("formats dates in Asia/Jakarta", () => {
    // 2026-01-31T20:00Z is already 1 Feb in Jakarta (UTC+7)
    expect(n(formatDate("2026-01-31T20:00:00Z"))).toMatch(/1 Feb 2026/);
  });
});
