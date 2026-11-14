import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "@/lib/master-data/demo-seed";
import { seedDemoSales } from "@/lib/master-data/demo-sales";
import { queryOne } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { createOrganization, createUser, setMembership } from "@/lib/admin/users";
import { AuthorizationError } from "@/lib/data/master-data";
import { getAdDetail, getCreativeOverview } from "@/lib/data/creative";
import { classificationSchema, updateClassification } from "@/lib/creative/manage";
import { importTables, sha256 } from "@/lib/imports/pipeline";
import { commitImportBatch } from "@/lib/imports/commit";
import { csvTables, MIME_TYPES } from "@/lib/imports/sources";
import { getEventDetail, listEvents } from "@/lib/data/events";
import { getAffiliatesOverview } from "@/lib/data/affiliates";
import { applyAllocation, approveAllocation, proposeAllocations } from "@/lib/affiliates/manage";
import { sessionFor, setupTestDatabase } from "./helpers";

const NOW = new Date("2026-11-11T03:00:00Z");
const TODAY = "2026-11-11";

let teardown: () => Promise<void>;
let owner: ActiveSession;
let analyst: ActiveSession;
let viewer: ActiveSession;
let outsider: ActiveSession;
const userId = async (email: string) =>
  (await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]))!.id;

beforeAll(async () => {
  ({ teardown } = await setupTestDatabase("phase45"));
  await seedDemo({ withUsers: true });
  await seedDemoSales(join(process.cwd(), "samples"), NOW);
  owner = await sessionFor(await userId("owner.demo@uray.local"));
  analyst = await sessionFor(await userId("analyst.demo@uray.local"));
  viewer = await sessionFor(await userId("viewer.demo@uray.local"));
  await createOrganization({ name: "Other Org (TEST)", slug: "other-p45", isDemo: true });
  await createUser({ email: "outsider@p45.test", password: "MaduHutan2026" });
  await setMembership({ organizationSlug: "other-p45", email: "outsider@p45.test", role: "owner" });
  outsider = await sessionFor(await userId("outsider@p45.test"));
}, 180_000);
afterAll(() => teardown());

describe("Phase 4 — Kreatif Meta", () => {
  it("overview: winners, fatigue and MI vs VIF from the database", async () => {
    const o = await getCreativeOverview(viewer, { range: "90d" }, { today: TODAY });
    if (o.status !== "ok") throw new Error("empty");
    expect(o.asOf).toBe("2026-11-10");
    expect(o.ads.length).toBeGreaterThan(5);
    expect(o.miVsVif.mi && o.miVsVif.vif).toBeTruthy();
    expect(o.ads.some((a) => a.parseStatus !== "ok")).toBe(true);
    expect(o.ads.every((a) => a.assetId !== null)).toBe(true);
    expect(await getCreativeOverview(outsider, {}, { today: TODAY })).toEqual({ status: "empty" });
  });

  it("a manual classification survives re-importing the ad", async () => {
    const o = await getCreativeOverview(viewer, { range: "30d" }, { today: TODAY });
    if (o.status !== "ok") throw new Error("empty");
    const bad = o.ads.find((a) => a.parseStatus === "failed")!;
    const input = classificationSchema.parse({
      product: "HUTAN500",
      hook: "PROMO",
      angle: "HEMAT",
      format: "motion_image",
      batch: "B05",
      version: "V1",
    });
    await expect(updateClassification(viewer, bad.adId, input)).rejects.toBeInstanceOf(AuthorizationError);
    expect(await updateClassification(analyst, bad.adId, input)).toBe(true);

    const csv = `tanggal,ad_id,nama_iklan,spend,impresi,klik,pembelian,nilai_pembelian\n2026-11-10,${bad.adId},${bad.name},1000,100,1,0,0\n`;
    const buf = Buffer.from(csv);
    const res = await importTables(analyst, {
      source: {
        kind: "file_upload",
        ref: null,
        fileName: "ulang.csv",
        mimeType: MIME_TYPES.csv,
        sizeBytes: buf.length,
      },
      contentSha256: sha256(buf),
      tables: csvTables("ulang.csv", buf),
      now: NOW,
    });
    expect((await commitImportBatch(analyst, res.staged[0].batchId)).status).toBe("committed");
    const d = await getAdDetail(viewer, bad.adId);
    expect(d.status === "ok" && d.info).toMatchObject({ source: "manual", hook: "PROMO", format: "motion_image" });
  });
});

describe("Phase 5 — events", () => {
  it("profit is computed with versioned COGS; viewers do not see it", async () => {
    const a = await listEvents(analyst);
    const sponsor = a.events.find((e) => e.name.startsWith("Sponsorship"))!;
    expect(sponsor.total.netProfit!).toBeLessThan(0);
    const ramadan = a.events.find((e) => e.name.startsWith("Bazar Ramadan"))!;
    expect(ramadan.total.netProfit!).toBeGreaterThan(0);
    expect(ramadan.total.revenue).toBeGreaterThan(ramadan.eventOnly.revenue); // post-event attribution

    const v = await listEvents(viewer);
    expect(v.restricted).toBe(true);
    expect(v.events.every((e) => e.total.netProfit === null && e.total.cogs === null)).toBe(true);

    const halal = a.events.find((e) => e.name.startsWith("Halal"))!;
    const d = await getEventDetail(analyst, halal.id);
    // Madu Hutan 500 g after 1 Jul uses the +8% COGS version.
    expect(d.status === "ok" && d.sales.find((s) => s.sku === "MU-HUTAN-500")!.unitCogs).toBe(73_500);
    expect(await getEventDetail(outsider, halal.id)).toEqual({ status: "not_found" });
  });
});

describe("Phase 5 — HSL allocations", () => {
  it("recommendations never exceed free warehouse stock; approve/apply re-check stock", async () => {
    const o = await getAffiliatesOverview(viewer, {}, { today: TODAY });
    if (o.status !== "ok") throw new Error("empty");
    for (const s of o.stock) {
      const proposed = o.recommendations.filter((r) => r.sku === s.sku).reduce((x, r) => x + r.quantity, 0);
      expect(proposed).toBeLessThanOrEqual(s.warehouse - s.reserved);
    }
    expect(o.idle.some((r) => r.affiliateName === "Kopi Pagi ID")).toBe(true);

    const rec = o.recommendations.find((r) => r.quantity > 0)!;
    await expect(
      proposeAllocations(viewer, [{ affiliateId: rec.affiliateId, sku: rec.sku, quantity: 1, basis: {} }]),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await proposeAllocations(analyst, [
      { affiliateId: rec.affiliateId, sku: rec.sku, quantity: rec.quantity, basis: {} },
    ]);
    const proposal = (await queryOne<{ id: string }>(
      "SELECT id FROM hsl_allocations WHERE status = 'diusulkan' ORDER BY proposed_at DESC LIMIT 1",
    ))!;
    await expect(approveAllocation(analyst, proposal.id, 1)).rejects.toBeInstanceOf(AuthorizationError);

    const stock = o.stock.find((s) => s.sku === rec.sku)!;
    const tooMuch = await approveAllocation(owner, proposal.id, stock.warehouse + 1);
    expect(tooMuch.ok).toBe(false);
    expect((await approveAllocation(owner, proposal.id, rec.quantity)).ok).toBe(true);
    expect((await applyAllocation(owner, proposal.id, { occurredOn: "2026-11-11" })).ok).toBe(true);
    expect((await applyAllocation(owner, proposal.id)).ok).toBe(false); // already applied

    const after = await getAffiliatesOverview(viewer, {}, { today: TODAY });
    if (after.status !== "ok") throw new Error("empty");
    expect(after.stock.find((s) => s.sku === rec.sku)!.warehouse).toBe(stock.warehouse - rec.quantity);
    expect((await getAffiliatesOverview(outsider, {}, { today: TODAY })).status).toBe("empty");
  });
});
