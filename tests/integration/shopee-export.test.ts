import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "@/lib/master-data/demo-seed";
import { queryOne, queryRows } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { importUploadedFiles } from "@/lib/imports/pipeline";
import { commitImportBatch, previewCommit } from "@/lib/imports/commit";
import { sessionFor, setupTestDatabase } from "./helpers";

const NAME = "parentskudetail.20261020_20261020.xlsx";
const buf = readFileSync(join(process.cwd(), "samples/shopee", NAME));
const NOW = new Date("2026-11-11T03:00:00Z");

let teardown: () => Promise<void>;
let analyst: ActiveSession;

const listing = (externalProductId: string) =>
  queryOne<{ id: string; sku: string | null; mapping_source: string | null }>(
    `SELECT l.id, v.sku, l.mapping_source FROM channel_listings l
       LEFT JOIN product_variants v ON v.organization_id = l.organization_id AND v.id = l.variant_id
      WHERE l.organization_id = ? AND l.external_product_id = ?`,
    [analyst.organization.id, externalProductId],
  );

beforeAll(async () => {
  ({ teardown } = await setupTestDatabase("shopee"));
  await seedDemo({ withUsers: true });
  const u = await queryOne<{ id: string }>("SELECT id FROM users WHERE email = 'analyst.demo@uray.local'");
  analyst = await sessionFor(u!.id);
});
afterAll(() => teardown());

describe("Shopee Seller Center export end to end", () => {
  it("stages, previews auto-mapping by SKU Induk, and commits ready-to-ship figures", async () => {
    const res = await importUploadedFiles(analyst, [{ name: NAME, buffer: buf }], { now: NOW });
    expect(res.rejected).toEqual([]);
    expect(res.staged).toHaveLength(1);
    const batchId = res.staged[0].batchId;

    // DEMO-SP-1002 already exists (mapped by the DEMO Master Listing) and is left untouched.
    expect(await previewCommit(analyst, batchId)).toMatchObject({
      rows: 4,
      inserts: 4,
      newListings: 3,
      autoMapped: 2,
      unmatchedSkus: ["MU-TIDAK-ADA"],
      unknownSkus: [],
    });
    expect((await commitImportBatch(analyst, batchId)).status).toBe("committed");

    expect(await listing("DEMO-SP-2001")).toMatchObject({ sku: "MU-RANDU-500", mapping_source: "auto" });
    expect(await listing("DEMO-SP-2002")).toMatchObject({ sku: "MU-HUTAN-1000", mapping_source: "auto" });
    expect(await listing("DEMO-SP-2003")).toMatchObject({ sku: null, mapping_source: null });
    expect(await listing("DEMO-SP-1002")).toMatchObject({ sku: "MU-KLG-500", mapping_source: "manual" });

    const facts = await queryRows<{ gmv: string; orders: number; units_sold: number }>(
      `SELECT f.gmv, f.orders, f.units_sold FROM listing_daily_facts f
         JOIN channel_listings l ON l.organization_id = f.organization_id AND l.id = f.listing_id
        WHERE f.organization_id = ? AND f.fact_date = '2026-10-20' AND l.external_product_id = 'DEMO-SP-2001'`,
      [analyst.organization.id],
    );
    expect(facts.map((f) => [Number(f.gmv), f.orders, f.units_sold])).toEqual([[3910000, 46, 51]]);
  });

  it("maps a listing that was created unmapped once its SKU is known, without remapping mapped ones", async () => {
    // Same listings, another day, with DEMO-SP-2003 now carrying a known SKU.
    const csv = Buffer.from(
      "tanggal,channel,id_produk_channel,id_sku_channel,nama_listing,gmv,pesanan,unit_terjual,sku_internal\n" +
        "2026-10-21,shopee,DEMO-SP-2003,,Madu Uray Edisi Terbatas (DEMO),100000,1,1,MU-KLC-150\n" +
        "2026-10-21,shopee,DEMO-SP-2001,,Madu Randu Uray 500gr (DEMO),100000,1,1,MU-KLC-150\n",
    );
    const res = await importUploadedFiles(analyst, [{ name: "koreksi.csv", buffer: csv }], { now: NOW });
    const batchId = res.staged[0].batchId;
    expect(await previewCommit(analyst, batchId)).toMatchObject({ newListings: 0, autoMapped: 1 });
    expect((await commitImportBatch(analyst, batchId)).status).toBe("committed");
    expect(await listing("DEMO-SP-2003")).toMatchObject({ sku: "MU-KLC-150", mapping_source: "auto" });
    expect(await listing("DEMO-SP-2001")).toMatchObject({ sku: "MU-RANDU-500" });
  });
});
