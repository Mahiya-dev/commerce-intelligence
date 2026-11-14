import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "@/lib/master-data/demo-seed";
import { queryOne } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { importUploadedFiles } from "@/lib/imports/pipeline";
import { commitImportBatch, previewCommit } from "@/lib/imports/commit";
import { getMarketplaceAds } from "@/lib/data/marketplace-ads";
import { createOrganization, createUser, setMembership } from "@/lib/admin/users";
import { sessionFor, setupTestDatabase } from "./helpers";

const NAME = "DataKeseluruhanIklanShopee-20_10_2026-20_10_2026.csv";
const buf = readFileSync(join(process.cwd(), "samples/shopee", NAME));
const NOW = new Date("2026-11-11T03:00:00Z");

let teardown: () => Promise<void>;
let analyst: ActiveSession;
let outsider: ActiveSession;

const userId = async (email: string) =>
  (await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]))!.id;

async function importAndCommit(buffer: Buffer) {
  const res = await importUploadedFiles(analyst, [{ name: NAME, buffer }], { now: NOW });
  expect(res.rejected).toEqual([]);
  const batchId = res.staged[0].batchId;
  const plan = await previewCommit(analyst, batchId);
  expect((await commitImportBatch(analyst, batchId)).status).toBe("committed");
  return plan;
}

beforeAll(async () => {
  ({ teardown } = await setupTestDatabase("shopeeads"));
  await seedDemo({ withUsers: true });
  analyst = await sessionFor(await userId("analyst.demo@uray.local"));
  await createOrganization({ name: "Other Org (TEST)", slug: "other-ads", isDemo: true });
  await createUser({ email: "outsider@ads.test", password: "MaduHutan2026" });
  await setMembership({ organizationSlug: "other-ads", email: "outsider@ads.test", role: "owner" });
  outsider = await sessionFor(await userId("outsider@ads.test"));
});
afterAll(() => teardown());

describe("Shopee Ads export end to end", () => {
  it("stores one row per campaign per day and summarises per channel", async () => {
    expect(await importAndCommit(buf)).toMatchObject({ rows: 2, inserts: 2, overwrites: 0 });
    const ads = await getMarketplaceAds(analyst, { from: "2026-10-01", to: "2026-10-31" });
    expect(ads).toEqual([
      {
        code: "shopee",
        name: "Shopee",
        days: 1,
        campaigns: 2,
        cost: 1200000,
        gmv: 10450000,
        impressions: 60000,
        clicks: 1840,
        conversions: 129,
        units: 160,
      },
    ]);
  });

  it("re-importing the same day overwrites instead of double counting", async () => {
    // Shopee updates a day's figures later; the newer file replaces the old rows.
    const updated = Buffer.from(buf.toString("utf8").replace(",1000000,9.60,", ",1100000,9.60,"));
    expect(await importAndCommit(updated)).toMatchObject({ rows: 2, inserts: 0, overwrites: 2 });
    const [shopee] = await getMarketplaceAds(analyst, { from: "2026-10-20", to: "2026-10-20" });
    expect(shopee.cost).toBe(1300000);
  });

  it("is tenant-scoped", async () => {
    expect(await getMarketplaceAds(outsider, { from: "2026-10-01", to: "2026-10-31" })).toEqual([]);
  });
});
