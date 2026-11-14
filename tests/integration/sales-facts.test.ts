import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "@/lib/master-data/demo-seed";
import { AuthorizationError } from "@/lib/data/master-data";
import { queryOne } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { importTables, sha256 } from "@/lib/imports/pipeline";
import { csvTables, MIME_TYPES, readUploadedFile, type SourceTable } from "@/lib/imports/sources";
import { canCommitReportType, commitImportBatch, previewCommit } from "@/lib/imports/commit";
import { getEcommerceOverview } from "@/lib/data/ecommerce";
import { createOrganization, createUser, setMembership } from "@/lib/admin/users";
import { expectDbError, sessionFor, setupTestDatabase } from "./helpers";

const SAMPLES = join(process.cwd(), "samples/phase-2");
const NOW = new Date("2026-11-11T03:00:00Z");
const TODAY = "2026-11-11";
const expected = JSON.parse(readFileSync(join(SAMPLES, "expected.json"), "utf8")).expected;

let teardown: () => Promise<void>;
let analyst: ActiveSession;
let admin: ActiveSession;
let viewer: ActiveSession;
let outsider: ActiveSession;

const userId = async (email: string) =>
  (await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]))!.id;
const count = async (sql: string, params: unknown[] = []) => Number((await queryOne<{ n: number }>(sql, params))!.n);

async function stage(session: ActiveSession, name: string, buf: Buffer, tables?: SourceTable[]) {
  const res = await importTables(session, {
    source: { kind: "file_upload", ref: null, fileName: name, mimeType: MIME_TYPES.csv, sizeBytes: buf.length },
    contentSha256: sha256(buf),
    tables: tables ?? readUploadedFile(name, buf).tables,
    now: NOW,
  });
  expect(res.rejected).toEqual([]);
  return res.staged[0].batchId;
}
const stageSample = (session: ActiveSession, file: string) =>
  stage(session, file.split("/").pop()!, readFileSync(join(SAMPLES, file)));
const stageCsv = (session: ActiveSession, name: string, text: string) => {
  const buf = Buffer.from(text);
  return stage(session, name, buf, csvTables(name, buf));
};

beforeAll(async () => {
  ({ teardown } = await setupTestDatabase("facts"));
  await seedDemo({ withUsers: true });
  analyst = await sessionFor(await userId("analyst.demo@uray.local"));
  admin = await sessionFor(await userId("admin.demo@uray.local"));
  viewer = await sessionFor(await userId("viewer.demo@uray.local"));
  await createOrganization({ name: "Other Org (TEST)", slug: "other-facts", isDemo: true });
  await createUser({ email: "outsider@facts.test", password: "MaduHutan2026" });
  await setMembership({ organizationSlug: "other-facts", email: "outsider@facts.test", role: "owner" });
  outsider = await sessionFor(await userId("outsider@facts.test"));
});
afterAll(() => teardown());

describe("commit guards", () => {
  it("refuses a batch with rejected rows (all-or-nothing)", async () => {
    const id = await stageSample(analyst, "csv/ERROR_kinerja_toko_harian_DEMO.csv");
    expect(await commitImportBatch(analyst, id, { acknowledgeWarnings: true })).toEqual({
      status: "rejected",
      reason: "invalid_rows",
    });
    expect(await count("SELECT COUNT(*) AS n FROM sales_daily_facts")).toBe(0);
  });

  it("requires acknowledging warnings", async () => {
    const id = await stageCsv(
      analyst,
      "warn.csv",
      // pesanan_batal > pesanan → warning, row stays valid
      "tanggal,channel,gmv,pesanan,unit_terjual,pengunjung,pembeli,pesanan_batal,gmv_batal,gmv_retur\n" +
        "2026-08-01,shopee,1000,5,5,100,5,9,,\n",
    );
    expect(await commitImportBatch(analyst, id)).toEqual({ status: "rejected", reason: "warnings_not_acknowledged" });
    expect((await commitImportBatch(analyst, id, { acknowledgeWarnings: true })).status).toBe("committed");
    expect(await commitImportBatch(analyst, id, { acknowledgeWarnings: true })).toEqual({
      status: "rejected",
      reason: "status",
    });
  });

  it("blocks a master listing with an unknown internal SKU", async () => {
    const id = await stageCsv(
      analyst,
      "listing-unknown.csv",
      "channel,id_produk_channel,id_sku_channel,nama_listing,sku_internal,isi_per_listing\n" +
        "shopee,NEW-1,,Listing baru,MU-TIDAK-ADA,1\n",
    );
    const out = await commitImportBatch(analyst, id);
    expect(out).toMatchObject({ status: "rejected", reason: "unknown_skus", plan: { unknownSkus: ["MU-TIDAK-ADA"] } });
    expect(await count("SELECT COUNT(*) AS n FROM channel_listings WHERE external_product_id = 'NEW-1'")).toBe(0);
  });

  it("is tenant-scoped and analyst-only", async () => {
    const id = await stageSample(analyst, "csv/target_bulanan_DEMO.csv");
    expect(await commitImportBatch(outsider, id)).toEqual({ status: "not_found" });
    expect(await previewCommit(outsider, id)).toBeNull();
    await expect(commitImportBatch(viewer, id)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("lets analysts stage targets but only admins/owners save them", async () => {
    const id = (await queryOne<{ id: string }>(
      "SELECT id FROM import_batches WHERE report_type = 'sales_target' AND status = 'validated'",
    ))!.id;
    expect(canCommitReportType(analyst, "sales_target")).toBe(false);
    expect(canCommitReportType(analyst, "marketplace_sales_daily")).toBe(true);
    expect(canCommitReportType(admin, "sales_target")).toBe(true);
    expect(await commitImportBatch(analyst, id, {})).toEqual({ status: "rejected", reason: "targets_forbidden" });
    expect(await count("SELECT COUNT(*) AS n FROM sales_targets")).toBe(0);
  });
});

describe("DEMO data end to end", () => {
  it("commits all four DEMO reports and reproduces the Kunci Jawaban", async () => {
    // Targets were staged (not committed) by the tenancy test above.
    const targetsId = (await queryOne<{ id: string }>(
      "SELECT id FROM import_batches WHERE report_type = 'sales_target' AND status = 'validated'",
    ))!.id;
    const listingId = await stageSample(analyst, "csv/master_listing_DEMO.csv");
    const shopId = await stageSample(analyst, "csv/kinerja_toko_harian_DEMO.csv");
    const productId = await stageSample(analyst, "csv/kinerja_produk_harian_DEMO.csv");

    // Preview: the DEMO seed already holds the 10 listings; the August row from the warning test is not overwritten.
    expect(await previewCommit(analyst, listingId)).toMatchObject({ rows: 10, inserts: 0, overwrites: 10 });
    expect(await previewCommit(analyst, shopId)).toMatchObject({ rows: 212, inserts: 212, overwrites: 0 });
    expect(await previewCommit(analyst, productId)).toMatchObject({ rows: 708, newListings: 0 });

    for (const id of [listingId, targetsId, shopId, productId]) {
      const by = id === targetsId ? admin : analyst;
      expect((await commitImportBatch(by, id)).status, id).toBe("committed");
    }
    expect(await count("SELECT COUNT(*) AS n FROM sales_daily_facts WHERE fact_date >= '2026-09-01'")).toBe(212);
    expect(await count("SELECT COUNT(*) AS n FROM listing_daily_facts")).toBe(708);
    expect(await count("SELECT COUNT(*) AS n FROM sales_targets")).toBe(9);
    expect(
      await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'import.committed' AND entity_id = ?", [shopId]),
    ).toBe(1);
    expect(
      await count("SELECT COUNT(*) AS n FROM import_rows WHERE batch_id = ? AND status = 'committed'", [shopId]),
    ).toBe(212);

    const o = await getEcommerceOverview(viewer, { today: TODAY });
    if (o.status !== "ok") throw new Error("expected data");
    expect(o.asOf).toBe("2026-11-10");
    expect(o.channels.map((c) => c.code)).toEqual(["shopee", "tiktok_shop", "tokopedia"]);

    const nov = o.months[2];
    expect(nov.all.gmv).toBe(expected.sec1["Nov 2026 (MTD)|SEMUA"].H);
    expect(o.months[1].rows[2].totals.days).toBe(expected.sec1["Okt 2026|tokopedia"].F);
    expect(o.mom.all.gmvChange).toBeCloseTo(expected.sec2.SEMUA.D, 12);
    for (const r of o.targets.rows) {
      expect(r.result?.progress).toBeCloseTo(expected.sec3[r.channel].E, 12);
      expect(r.result?.runRateNeeded).toBeCloseTo(expected.sec3[r.channel].I, 6);
    }

    // §5: GMV per internal SKU via the listing mapping; unmapped listings grouped as null.
    const bySku = Object.fromEntries(o.skus.map((s) => [s.sku ?? "BELUM DIPETAKAN", s.gmv]));
    expect(bySku).toEqual(
      Object.fromEntries(Object.entries(expected.sec5).map(([k, v]) => [k, (v as { B: number }).B])),
    );
    expect(o.skuCoverage).toEqual({ listingGmv: nov.all.gmv, shopGmv: nov.all.gmv });

    // Chart series agree with the KPI cards they illustrate.
    expect(o.charts.daily[0].points[0].date).toBe("2026-10-01");
    expect(o.charts.daily.at(-1)!.points.at(-1)!.date).toBe("2026-11-10");
    const novDaily = o.charts.daily.flatMap((s) => s.points.filter((p) => p.date >= "2026-11-01"));
    expect(novDaily.reduce((sum, p) => sum + (p.value ?? 0), 0)).toBe(nov.all.gmv);
    const cumulative = o.charts.cumulative!;
    expect(cumulative.find((p) => p.date === o.asOf)?.actual).toBe(o.targets.all!.actual);
    expect(cumulative.at(-1)!.pace).toBeCloseTo(o.targets.all!.target, 6);
  });

  it("re-importing the same period overwrites instead of double counting", async () => {
    const text = readFileSync(join(SAMPLES, "csv/kinerja_toko_harian_DEMO.csv"), "utf8")
      .split("\n")
      .filter((l, i) => i === 0 || l.startsWith("2026-11-10,shopee"))
      .join("\n")
      .replace("2026-11-10,shopee,13054500", "2026-11-10,shopee,13054501");
    const id = await stageCsv(analyst, "koreksi.csv", text);
    expect(await previewCommit(analyst, id)).toMatchObject({ rows: 1, inserts: 0, overwrites: 1 });
    expect((await commitImportBatch(analyst, id)).status).toBe("committed");
    const o = await getEcommerceOverview(analyst, { today: TODAY });
    if (o.status !== "ok") throw new Error("expected data");
    expect(o.months[2].all.gmv).toBe(expected.sec1["Nov 2026 (MTD)|SEMUA"].H + 1);
    const fact = await queryOne<{ source_batch_id: string }>(
      "SELECT source_batch_id FROM sales_daily_facts WHERE fact_date = '2026-11-10' AND channel_id = '0c0a0000-0000-4000-8000-000000000001'",
    );
    expect(fact?.source_batch_id).toBe(id);
  });

  it("keeps other tenants empty and enforces listing/channel consistency in the database", async () => {
    expect(await getEcommerceOverview(outsider, { today: TODAY })).toEqual({ status: "empty" });
    const listing = (await queryOne<{ id: string; organization_id: string; channel_id: string }>(
      "SELECT id, organization_id, channel_id FROM channel_listings WHERE external_product_id = 'DEMO-SP-1001' LIMIT 1",
    ))!;
    const batch = (await queryOne<{ id: string }>("SELECT id FROM import_batches LIMIT 1"))!;
    // A fact pointing at a Shopee listing but claiming TikTok Shop is refused by the composite FK.
    await expectDbError(
      queryOne(
        `INSERT INTO listing_daily_facts (organization_id, listing_id, fact_date, channel_id, gmv, orders, units_sold, source_batch_id)
         VALUES (?, ?, '2026-01-01', '0c0a0000-0000-4000-8000-000000000002', 1, 1, 1, ?)`,
        [listing.organization_id, listing.id, batch.id],
      ),
      ["ER_NO_REFERENCED_ROW_2"],
    );
  });
});
