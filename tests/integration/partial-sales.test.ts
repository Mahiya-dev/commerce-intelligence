import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryOne } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { importUploadedFiles } from "@/lib/imports/pipeline";
import { commitImportBatch } from "@/lib/imports/commit";
import { getSalesForRange } from "@/lib/data/ecommerce";
import { createOrganization, createUser, setMembership } from "@/lib/admin/users";
import { sessionFor, setupTestDatabase } from "./helpers";

const SHOPEE = join(process.cwd(), "samples/shopee");
const FILES = ["parentskudetail.20261020_20261020.xlsx", "DataKeseluruhanIklanShopee-20_10_2026-20_10_2026.csv"];
const NOW = new Date("2026-11-11T03:00:00Z");
const TODAY = "2026-11-11";

let teardown: () => Promise<void>;
let owner: ActiveSession;

beforeAll(async () => {
  ({ teardown } = await setupTestDatabase("partial"));
  // A real-like organization with no DEMO data and no shop report.
  await createOrganization({ name: "Toko Baru (TEST)", slug: "toko-baru", isDemo: false });
  await createUser({ email: "owner@toko.test", password: "MaduHutan2026" });
  await setMembership({ organizationSlug: "toko-baru", email: "owner@toko.test", role: "owner" });
  const u = await queryOne<{ id: string }>("SELECT id FROM users WHERE email = 'owner@toko.test'");
  owner = await sessionFor(u!.id);
});
afterAll(() => teardown());

describe("E-Commerce without a shop report", () => {
  it("is empty before anything is imported", async () => {
    expect(await getSalesForRange(owner, {}, { today: TODAY, includeSkus: true })).toEqual({ status: "empty" });
  });

  it("anchors on product and ads reports and never invents shop KPIs", async () => {
    const res = await importUploadedFiles(
      owner,
      FILES.map((f) => ({ name: f, buffer: readFileSync(join(SHOPEE, f)) })),
      { now: NOW },
    );
    expect(res.rejected).toEqual([]);
    for (const b of res.staged) expect((await commitImportBatch(owner, b.batchId)).status).toBe("committed");

    const out = await getSalesForRange(owner, { range: "mtd" }, { today: TODAY, includeSkus: true });
    expect(out.status).toBe("partial");
    if (out.status !== "partial") throw new Error("unreachable");
    expect(out.asOf).toBe("2026-10-20");
    expect(out.range).toMatchObject({ from: "2026-10-01", to: "2026-10-20" });
    // No Master Produk yet: every listing is unmapped, GMV = ready-to-ship sum of the sample.
    expect(out.skus).toEqual([{ sku: null, name: null, gmv: 3910000 + 2640000 + 1650000 + 1150500, units: 79 }]);
    expect(out.skuCoverage).toEqual({ listingGmv: 9350500, shopGmv: null });
    expect(out).not.toHaveProperty("current");
  });
});
