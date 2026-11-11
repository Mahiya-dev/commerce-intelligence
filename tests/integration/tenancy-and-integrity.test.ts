import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createOrganization, createUser, removeMembership, setMembership, AdminError } from "@/lib/admin/users";
import {
  AuthorizationError,
  getMasterDataSummary,
  listAuditLogs,
  listChannelListings,
  listMembers,
  listProductsWithVariants,
} from "@/lib/data/master-data";
import { DEMO_ORG_SLUG, seedDemo, SeedRefusedError } from "@/lib/master-data/demo-seed";
import { assertValidBundleComponent, BundleRuleError } from "@/lib/master-data/bundles";
import { execute, getPool, queryOne } from "@/lib/db/pool";
import { authenticate } from "@/lib/auth/login";
import { CHECK_VIOLATION, expectDbError, sessionFor, setupTestDatabase } from "./helpers";

let teardown: () => Promise<void>;
let demoOrg: string;
let otherOrg: string;
const id = async (email: string) =>
  (await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]))!.id;
const PW = "MaduHutan2026";

beforeAll(async () => {
  ({ teardown } = await setupTestDatabase("tenancy"));
  ({ organizationId: demoOrg } = await seedDemo({ withUsers: true }));
  await seedDemo({ withUsers: true }); // idempotent

  otherOrg = await createOrganization({ name: "Other Org (TEST)", slug: "other-org", isDemo: true });
  await createUser({ email: "outsider@other.test", password: PW });
  await setMembership({ organizationSlug: "other-org", email: "outsider@other.test", role: "owner" });
  await execute("INSERT INTO products (id, organization_id, code, name) VALUES (?, ?, 'OTHER-1', 'Other Product')", [
    randomUUID(),
    otherOrg,
  ]);
  await authenticate("outsider@other.test", PW, "192.0.2.99");
});
afterAll(() => teardown());

describe("demo seed", () => {
  it("is idempotent and complete", async () => {
    const s = await sessionFor(await id("viewer.demo@uray.local"));
    expect(await getMasterDataSummary(s)).toMatchObject({
      products: 6,
      variants: 9,
      listings: 10,
      unmappedListings: 2,
    });
    expect(s.organization.isDemo).toBe(true);
  });
});

describe("tenant isolation (enforced in the data layer)", () => {
  it("each tenant only sees its own products, listings and counts", async () => {
    const demo = await sessionFor(await id("owner.demo@uray.local"));
    const other = await sessionFor(await id("outsider@other.test"));

    const demoCodes = (await listProductsWithVariants(demo, { includeCogs: true })).map((p) => p.code);
    const otherCodes = (await listProductsWithVariants(other, { includeCogs: true })).map((p) => p.code);
    expect(demoCodes).toHaveLength(6);
    expect(demoCodes).not.toContain("OTHER-1");
    expect(otherCodes).toEqual(["OTHER-1"]);
    expect(await listChannelListings(other)).toEqual([]);
    expect(await getMasterDataSummary(other)).toMatchObject({ products: 1, variants: 0, listings: 0 });
  });

  it("members and audit logs never cross tenants", async () => {
    const demo = await sessionFor(await id("owner.demo@uray.local"));
    const other = await sessionFor(await id("outsider@other.test"));
    expect((await listMembers(other)).map((m) => m.email)).toEqual(["outsider@other.test"]);
    expect((await listMembers(demo)).map((m) => m.email)).not.toContain("outsider@other.test");

    const otherIps = (await listAuditLogs(other)).map((a) => a.ipAddress);
    const demoIps = (await listAuditLogs(demo)).map((a) => a.ipAddress);
    expect(otherIps).toContain("192.0.2.99");
    expect(demoIps).not.toContain("192.0.2.99");
  });
});

describe("role enforcement inside the data layer", () => {
  it("viewers cannot read members, audit logs or COGS", async () => {
    const viewer = await sessionFor(await id("viewer.demo@uray.local"));
    await expect(listMembers(viewer)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listAuditLogs(viewer)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listProductsWithVariants(viewer, { includeCogs: true })).rejects.toBeInstanceOf(AuthorizationError);
    const products = await listProductsWithVariants(viewer, { includeCogs: false });
    expect(products.flatMap((p) => p.variants).every((v) => v.standardCogs === null)).toBe(true);
  });

  it("analysts see COGS", async () => {
    const analyst = await sessionFor(await id("analyst.demo@uray.local"));
    const variants = (await listProductsWithVariants(analyst, { includeCogs: true })).flatMap((p) => p.variants);
    expect(variants.find((v) => v.sku === "MU-HUTAN-500")?.standardCogs).toBe(68000);
  });
});

describe("membership rules", () => {
  it("keeps at least one active owner", async () => {
    await expect(
      setMembership({ organizationSlug: DEMO_ORG_SLUG, email: "owner.demo@uray.local", role: "admin" }),
    ).rejects.toBeInstanceOf(AdminError);
    await expect(
      setMembership({
        organizationSlug: DEMO_ORG_SLUG,
        email: "owner.demo@uray.local",
        role: "owner",
        status: "suspended",
      }),
    ).rejects.toBeInstanceOf(AdminError);
    await expect(
      removeMembership({ organizationSlug: DEMO_ORG_SLUG, email: "owner.demo@uray.local" }),
    ).rejects.toBeInstanceOf(AdminError);

    // With a second owner, demotion becomes possible.
    await setMembership({ organizationSlug: DEMO_ORG_SLUG, email: "admin.demo@uray.local", role: "owner" });
    await setMembership({ organizationSlug: DEMO_ORG_SLUG, email: "owner.demo@uray.local", role: "admin" });
    await setMembership({ organizationSlug: DEMO_ORG_SLUG, email: "owner.demo@uray.local", role: "owner" });
    await setMembership({ organizationSlug: DEMO_ORG_SLUG, email: "admin.demo@uray.local", role: "admin" });
  });

  it("audits membership changes in the same transaction, skipping no-ops", async () => {
    const before = await queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'member.updated'",
    );
    await setMembership({ organizationSlug: DEMO_ORG_SLUG, email: "viewer.demo@uray.local", role: "viewer" }); // unchanged
    await setMembership({ organizationSlug: DEMO_ORG_SLUG, email: "viewer.demo@uray.local", role: "analyst" });
    const after = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'member.updated'");
    expect(Number(after!.n) - Number(before!.n)).toBe(1);
    await setMembership({ organizationSlug: DEMO_ORG_SLUG, email: "viewer.demo@uray.local", role: "viewer" });
  });
});

describe("database integrity constraints (MySQL/MariaDB)", () => {
  const variant = async (sku: string) =>
    (await queryOne<{ id: string }>("SELECT id FROM product_variants WHERE organization_id = ? AND sku = ?", [
      demoOrg,
      sku,
    ]))!.id;

  it("composite FKs block cross-organization references", async () => {
    const demoProduct = await queryOne<{ id: string }>("SELECT id FROM products WHERE organization_id = ? LIMIT 1", [
      demoOrg,
    ]);
    await expectDbError(
      execute(
        "INSERT INTO product_variants (id, organization_id, product_id, sku, name) VALUES (?, ?, ?, 'BAD-1', 'x')",
        [randomUUID(), otherOrg, demoProduct!.id],
      ),
      ["ER_NO_REFERENCED_ROW_2"],
    );
  });

  it("CHECK constraints are enforced", async () => {
    const CHECK = [CHECK_VIOLATION];
    await expectDbError(
      execute("INSERT INTO organizations (id, name, slug) VALUES (?, 'Bad', 'Has-Upper')", [randomUUID()]),
      CHECK,
    );
    await expectDbError(
      execute("INSERT INTO users (id, email, password_hash) VALUES (?, 'Upper@x.test', 'scrypt$x')", [randomUUID()]),
      CHECK,
    );
    await expectDbError(
      execute("UPDATE product_variants SET standard_cogs = -1 WHERE organization_id = ?", [demoOrg]),
      CHECK,
    );
    await expectDbError(
      execute(
        "UPDATE channel_listings SET mapping_source = NULL WHERE organization_id = ? AND variant_id IS NOT NULL",
        [demoOrg],
      ),
      CHECK,
    );
    await expectDbError(
      execute(
        `INSERT INTO import_batches (id, organization_id, report_type, source_file_name, mime_type, file_size_bytes, file_sha256)
         VALUES (?, ?, 'meta_ads_performance', 'x.exe', 'application/x-msdownload', 10, REPEAT('c', 64))`,
        [randomUUID(), demoOrg],
      ),
      CHECK,
    );
  });

  it("duplicate imports are blocked while active and allowed after cancellation", async () => {
    const insert = () =>
      execute(
        `INSERT INTO import_batches (id, organization_id, report_type, source_file_name, mime_type, file_size_bytes, file_sha256)
         VALUES (?, ?, 'marketplace_sales_daily', 'sales.csv', 'text/csv', 10, REPEAT('b', 64))`,
        [randomUUID(), demoOrg],
      );
    await insert();
    await expectDbError(insert(), ["ER_DUP_ENTRY"]);
    await execute("UPDATE import_batches SET status = 'cancelled' WHERE organization_id = ?", [demoOrg]);
    await insert();
  });

  it("mapped variants cannot be deleted; duplicate listings are rejected", async () => {
    await expectDbError(execute("DELETE FROM product_variants WHERE id = ?", [await variant("MU-RANDU-500")]), [
      "ER_ROW_IS_REFERENCED_2",
    ]);
    await expectDbError(
      execute(
        `INSERT INTO channel_listings (id, organization_id, channel_id, external_product_id, listing_name)
         SELECT ?, organization_id, channel_id, external_product_id, 'dup' FROM channel_listings
          WHERE organization_id = ? AND external_product_id = 'DEMO-SP-1002'`,
        [randomUUID(), demoOrg],
      ),
      ["ER_DUP_ENTRY"],
    );
  });

  it("bundle rules: parent must be a bundle, no nesting, no self-reference", async () => {
    const pool = getPool();
    await expect(
      assertValidBundleComponent(pool, demoOrg, await variant("MU-HUTAN-500"), await variant("MU-KLG-250")),
    ).rejects.toBeInstanceOf(BundleRuleError);
    await expect(
      assertValidBundleComponent(pool, demoOrg, await variant("MU-PKT-KLG-01"), await variant("MU-PKT-KLG-01")),
    ).rejects.toBeInstanceOf(BundleRuleError);
    await expect(
      assertValidBundleComponent(pool, otherOrg, await variant("MU-PKT-KLG-01"), await variant("MU-KLG-250")),
    ).rejects.toBeInstanceOf(BundleRuleError);
    await assertValidBundleComponent(pool, demoOrg, await variant("MU-PKT-KLG-01"), await variant("MU-PRO-30"));
  });

  it("demo seed refuses to touch a database with real organizations", async () => {
    await createOrganization({ name: "Madu Uray", slug: "madu-uray" });
    await expect(seedDemo({ withUsers: false })).rejects.toBeInstanceOf(SeedRefusedError);
  });
});
