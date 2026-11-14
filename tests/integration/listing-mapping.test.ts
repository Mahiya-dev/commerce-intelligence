import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "@/lib/master-data/demo-seed";
import { AuthorizationError } from "@/lib/data/master-data";
import { queryOne } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { createOrganization, createUser, setMembership } from "@/lib/admin/users";
import { importUploadedFiles } from "@/lib/imports/pipeline";
import { commitImportBatch } from "@/lib/imports/commit";
import { getPortfolioOverview } from "@/lib/data/portfolio";
import {
  autoMapListings,
  ListingMappingError,
  mapListing,
  mapListingSchema,
  unmapListing,
} from "@/lib/master-data/listing-mapping";
import { sessionFor, setupTestDatabase } from "./helpers";

const NOW = new Date("2026-11-11T03:00:00Z");
let teardown: () => Promise<void>;
let owner: ActiveSession; // a real (non-DEMO) organization with an empty Master Produk
let demoViewer: ActiveSession;
let demoAnalyst: ActiveSession;

const userId = async (email: string) =>
  (await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]))!.id;
const listing = (session: ActiveSession, externalProductId: string) =>
  queryOne<{ id: string; sku: string | null; mapping_source: string | null; units_per_listing: number }>(
    `SELECT l.id, v.sku, l.mapping_source, l.units_per_listing FROM channel_listings l
       LEFT JOIN product_variants v ON v.organization_id = l.organization_id AND v.id = l.variant_id
      WHERE l.organization_id = ? AND l.external_product_id = ?`,
    [session.organization.id, externalProductId],
  );
const csv = (lines: string[]) =>
  Buffer.from(
    "tanggal,channel,id_produk_channel,id_sku_channel,nama_listing,gmv,pesanan,unit_terjual,sku_internal\n" +
      lines.join("\n") +
      "\n",
  );
async function importAndSave(session: ActiveSession, name: string, lines: string[]) {
  const res = await importUploadedFiles(session, [{ name, buffer: csv(lines) }], { now: NOW });
  expect(res.rejected).toEqual([]);
  const out = await commitImportBatch(session, res.staged[0].batchId, { acknowledgeWarnings: true });
  expect(out.status).toBe("committed");
}

beforeAll(async () => {
  ({ teardown } = await setupTestDatabase("listingmap"));
  await seedDemo({ withUsers: true });
  demoViewer = await sessionFor(await userId("viewer.demo@uray.local"));
  demoAnalyst = await sessionFor(await userId("analyst.demo@uray.local"));
  await createOrganization({ name: "Toko Asli", slug: "toko-asli" });
  await createUser({ email: "owner@tokoasli.test", password: "MaduHutan2026" });
  await setMembership({ organizationSlug: "toko-asli", email: "owner@tokoasli.test", role: "owner" });
  owner = await sessionFor(await userId("owner@tokoasli.test"));
});
afterAll(() => teardown());

describe("listing → SKU mapping", () => {
  it("an import creates unknown SKUs in an empty Master Produk and maps the listings", async () => {
    await importAndSave(owner, "produk.csv", [
      "2026-11-05,shopee,REAL-1,,Madu Hutan 500gr,150000,2,3,MH-500",
      "2026-11-05,shopee,REAL-2,,Madu Hutan 500gr isi 2,250000,2,2,mh-500",
      "2026-11-05,shopee,REAL-3,,Madu Tanpa SKU,90000,1,1,",
    ]);
    expect(await listing(owner, "REAL-1")).toMatchObject({ sku: "MH-500", mapping_source: "auto" });
    // Same SKU in another letter case is the same SKU, not a duplicate.
    expect(await listing(owner, "REAL-2")).toMatchObject({ sku: "MH-500", mapping_source: "auto" });
    expect(await listing(owner, "REAL-3")).toMatchObject({ sku: null, mapping_source: null });
    const n = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM product_variants WHERE organization_id = ?", [
      owner.organization.id,
    ]);
    expect(Number(n!.n)).toBe(1);
    // Portfolio now has something to show instead of failing.
    expect((await getPortfolioOverview(owner, { today: "2026-11-10" })).status).toBe("ok");
  });

  it("auto-map links listings saved earlier without a mapping, and reports the rest", async () => {
    // Simulate listings saved before SKUs were created automatically.
    const l1 = (await listing(owner, "REAL-1"))!;
    await unmapListing(owner, l1.id);
    expect(await listing(owner, "REAL-1")).toMatchObject({ sku: null, mapping_source: null });

    await expect(autoMapListings(demoViewer)).rejects.toBeInstanceOf(AuthorizationError);
    const result = await autoMapListings(owner, "192.0.2.30");
    expect(result).toEqual({ mapped: 1, createdSkus: [], remaining: 1 });
    expect(await listing(owner, "REAL-1")).toMatchObject({ sku: "MH-500", mapping_source: "auto" });
    expect(await autoMapListings(owner)).toEqual({ mapped: 0, createdSkus: [], remaining: 1 });
    expect(
      await queryOne("SELECT id FROM audit_logs WHERE organization_id = ? AND action = 'listing.auto_mapped'", [
        owner.organization.id,
      ]),
    ).not.toBeNull();
  });

  it("auto-map creates a SKU that was removed from Master Produk", async () => {
    const l2 = (await listing(owner, "REAL-2"))!;
    await unmapListing(owner, l2.id);
    await unmapListing(owner, (await listing(owner, "REAL-1"))!.id);
    const { execute } = await import("@/lib/db/pool");
    await execute("DELETE FROM products WHERE organization_id = ?", [owner.organization.id]);
    const result = await autoMapListings(owner);
    expect(result.mapped).toBe(2);
    expect(result.createdSkus).toHaveLength(1);
    expect((await listing(owner, "REAL-2"))!.sku?.toLowerCase()).toBe("mh-500");
  });

  it("manual mapping: existing SKU, new SKU only on request, units, unmap", async () => {
    const l3 = (await listing(owner, "REAL-3"))!;
    const input = (patch: Record<string, unknown>) =>
      mapListingSchema.parse({ sku: "MH-500", unitsPerListing: "1", createIfMissing: false, ...patch });

    expect(mapListingSchema.safeParse({ sku: "ada spasi", unitsPerListing: "1" }).success).toBe(false);
    expect(mapListingSchema.safeParse({ sku: "MH-500", unitsPerListing: "0" }).success).toBe(false);
    await expect(mapListing(demoViewer, l3.id, input({}))).rejects.toBeInstanceOf(AuthorizationError);
    // Tenant isolation: another organization's analyst cannot see this listing.
    await expect(mapListing(demoAnalyst, l3.id, input({}))).rejects.toBeInstanceOf(ListingMappingError);
    await expect(mapListing(owner, l3.id, input({ sku: "MT-250" }))).rejects.toBeInstanceOf(ListingMappingError);

    expect(
      await mapListing(owner, l3.id, input({ sku: "MT-250", createIfMissing: true, unitsPerListing: "2" })),
    ).toEqual({ sku: "MT-250", createdSku: true });
    expect(await listing(owner, "REAL-3")).toMatchObject({
      sku: "MT-250",
      mapping_source: "manual",
      units_per_listing: 2,
    });
    expect(await mapListing(owner, l3.id, input({ unitsPerListing: "1" }))).toMatchObject({ createdSku: false });
    expect((await listing(owner, "REAL-3"))!.sku?.toLowerCase()).toBe("mh-500");

    await unmapListing(owner, l3.id);
    expect(await listing(owner, "REAL-3")).toMatchObject({ sku: null, mapping_source: null });
  });
});
