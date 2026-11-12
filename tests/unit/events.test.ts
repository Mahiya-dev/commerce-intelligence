import { describe, expect, it } from "vitest";
import { attributionEnd, cogsLookup, counts, financials, leadSummary, type EventSale } from "@/lib/events/profit";
import { costSchema, eventSchema, leadSchema, saleSchema } from "@/lib/events/manage";

const W = { startDate: "2026-10-08", endDate: "2026-10-11", attributionDays: 30 };
const sale = (p: Partial<EventSale> = {}): EventSale => ({
  variantId: "v1",
  sku: "A",
  soldOn: "2026-10-09",
  units: 10,
  revenue: 1_500_000,
  phase: "event",
  ...p,
});

describe("attribution window", () => {
  it("counts event sales inside the event and post-event sales inside the window", () => {
    expect(attributionEnd(W)).toBe("2026-11-10");
    expect(counts(sale(), W)).toBe(true);
    expect(counts(sale({ soldOn: "2026-10-12" }), W)).toBe(false); // event sale after the event
    expect(counts(sale({ phase: "pasca_event", soldOn: "2026-11-10" }), W)).toBe(true);
    expect(counts(sale({ phase: "pasca_event", soldOn: "2026-11-11" }), W)).toBe(false);
    expect(counts(sale({ phase: "pasca_event", soldOn: "2026-10-10" }), W)).toBe(false);
  });
});

describe("financials", () => {
  const cogs = () => 60_000;

  it("computes contribution, net profit, break-even and ROI", () => {
    const f = financials(
      [sale()],
      [
        { costType: "tetap", amount: 500_000 },
        { costType: "variabel", amount: 100_000 },
      ],
      cogs,
    );
    expect(f).toMatchObject({
      revenue: 1_500_000,
      cogs: 600_000,
      grossProfit: 900_000,
      contribution: 800_000,
      netProfit: 300_000,
      breakEvenRevenue: 937_500, // 500.000 ÷ (800.000 / 1.500.000)
      breakEvenGap: 0,
    });
    expect(f.contributionMargin).toBeCloseTo(0.5333, 3);
    expect(f.roi).toBeCloseTo(300_000 / 1_200_000);
  });

  it("never derives profit from revenue alone: unknown COGS → profit unknown", () => {
    const f = financials([sale(), sale({ variantId: "v2", sku: "B" })], [], (v) => (v === "v1" ? 60_000 : null));
    expect(f).toMatchObject({ revenue: 3_000_000, cogs: null, netProfit: null, roi: null, missingCogs: ["B"] });
  });

  it("a negative margin cannot break even", () => {
    const f = financials([sale({ revenue: 500_000 })], [{ costType: "tetap", amount: 1_000_000 }], cogs);
    expect(f.netProfit).toBe(-1_100_000);
    expect(f.breakEvenRevenue).toBeNull();
    expect(f.breakEvenGap).toBeNull();
  });
});

describe("versioned COGS", () => {
  const lookup = cogsLookup(
    [
      { variantId: "hutan", effectiveFrom: "2026-07-01", unitCogs: 73_500 },
      { variantId: "hutan", effectiveFrom: "2026-01-01", unitCogs: 70_000 },
    ],
    new Map<string, number | null>([
      ["hutan", 68_000],
      ["klg", 42_000],
      ["bundle", null],
      ["nocogs", null],
    ]),
    new Map([
      [
        "bundle",
        [
          { componentId: "hutan", quantity: 2 },
          { componentId: "klg", quantity: 1 },
        ],
      ],
    ]),
  );

  it("uses the version effective on the sale date, then the standard COGS", () => {
    expect(lookup("hutan", "2025-12-31")).toBe(68_000);
    expect(lookup("hutan", "2026-03-01")).toBe(70_000);
    expect(lookup("hutan", "2026-07-01")).toBe(73_500);
  });

  it("a bundle without its own COGS sums its components on that date", () => {
    expect(lookup("bundle", "2026-03-01")).toBe(2 * 70_000 + 42_000);
    expect(lookup("bundle", "2026-08-01")).toBe(2 * 73_500 + 42_000);
    expect(lookup("nocogs", "2026-08-01")).toBeNull();
  });
});

describe("leads and input validation", () => {
  it("summarises leads", () => {
    expect(
      leadSummary([
        { leads: 100, converted: 10 },
        { leads: 50, converted: 5 },
      ]),
    ).toEqual({
      leads: 150,
      converted: 15,
      conversionRate: 0.1,
    });
    expect(leadSummary([]).conversionRate).toBeNull();
  });

  it("validates forms", () => {
    const ev = {
      name: "Bazar",
      kind: "bazar",
      location: "",
      startDate: "2026-10-08",
      endDate: "2026-10-07",
      status: "rencana",
      attributionDays: "30",
      notes: "",
    };
    expect(eventSchema.safeParse(ev).success).toBe(false);
    expect(eventSchema.safeParse({ ...ev, endDate: "2026-10-09", attributionDays: "365" }).success).toBe(false);
    expect(
      saleSchema.parse({
        sku: "A",
        soldOn: "2026-10-09",
        units: "3",
        revenue: "Rp 1.500.000",
        phase: "event",
        note: "",
      }).revenue,
    ).toBe(1_500_000);
    expect(
      saleSchema.safeParse({ sku: "A", soldOn: "2026-10-09", units: "0", revenue: "1", phase: "event", note: "" })
        .success,
    ).toBe(false);
    expect(
      costSchema.safeParse({ category: "sewa_booth", costType: "tetap", amount: "0", incurredOn: "", note: "" })
        .success,
    ).toBe(false);
    expect(
      leadSchema.safeParse({ capturedOn: "2026-10-09", source: "qr", leads: "5", converted: "6", note: "" }).success,
    ).toBe(false);
  });
});
