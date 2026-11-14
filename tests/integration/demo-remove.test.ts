import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_ORG_SLUG, seedDemo } from "@/lib/master-data/demo-seed";
import { seedDemoSales } from "@/lib/master-data/demo-sales";
import { DemoRemovalRefused, removeDemoData } from "@/lib/master-data/demo-remove";
import { createOrganization, createUser, setMembership } from "@/lib/admin/users";
import { execute, queryOne, queryRows } from "@/lib/db/pool";
import { setupTestDatabase } from "./helpers";

let teardown: () => Promise<void>;
let demoOrg: string;
let realOrg: string;

beforeAll(async () => {
  ({ teardown } = await setupTestDatabase("demoremove"));
  ({ organizationId: demoOrg } = await seedDemo({ withUsers: true }));
  await seedDemoSales(join(process.cwd(), "samples"), new Date("2026-11-11T03:00:00Z"));
  // A real organization with its own data must survive.
  realOrg = await createOrganization({ name: "Madu Uray", slug: "madu-uray" });
  await createUser({ email: "owner@maduuray.test", password: "MaduHutan2026" });
  await setMembership({ organizationSlug: "madu-uray", email: "owner@maduuray.test", role: "owner" });
  await execute("INSERT INTO products (id, organization_id, code, name) VALUES (UUID(), ?, 'REAL-1', 'Produk Asli')", [
    realOrg,
  ]);
}, 240_000);
afterAll(() => teardown());

const orgTables = async () =>
  (
    await queryRows<{ t: string }>(
      `SELECT TABLE_NAME AS t FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'organization_id' AND TABLE_NAME <> 'organizations'`,
    )
  ).map((r) => r.t);

describe("remove DEMO data", () => {
  it("requires the exact confirmation and a DEMO-flagged organization", async () => {
    await expect(removeDemoData({ confirmSlug: "madu-uray" })).rejects.toBeInstanceOf(DemoRemovalRefused);
    await execute("UPDATE organizations SET is_demo = 0 WHERE id = ?", [demoOrg]);
    await expect(removeDemoData({ confirmSlug: DEMO_ORG_SLUG })).rejects.toBeInstanceOf(DemoRemovalRefused);
    await execute("UPDATE organizations SET is_demo = 1 WHERE id = ?", [demoOrg]);
  });

  it("removes every DEMO row and the demo accounts, keeping the real organization", async () => {
    const result = await removeDemoData({ confirmSlug: DEMO_ORG_SLUG });
    expect(result.status).toBe("removed");
    if (result.status !== "removed") return;
    expect(result.rows.sales_daily_facts).toBeGreaterThan(0);
    expect(result.users.sort()).toEqual([
      "admin.demo@uray.local",
      "analyst.demo@uray.local",
      "owner.demo@uray.local",
      "viewer.demo@uray.local",
    ]);

    for (const t of await orgTables()) {
      const left = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM \`${t}\` WHERE organization_id = ?`, [
        demoOrg,
      ]);
      expect(Number(left!.n), t).toBe(0);
    }
    expect(await queryOne("SELECT id FROM organizations WHERE id = ?", [demoOrg])).toBeNull();
    expect(
      Number(
        (await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%.demo@uray.local'"))!.n,
      ),
    ).toBe(0);

    // Real organization, its member and data are untouched; reference data stays.
    expect(await queryOne("SELECT id FROM organizations WHERE id = ?", [realOrg])).not.toBeNull();
    expect(
      Number(
        (await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM products WHERE organization_id = ?", [realOrg]))!.n,
      ),
    ).toBe(1);
    expect(await queryOne("SELECT id FROM users WHERE email = 'owner@maduuray.test'")).not.toBeNull();
    expect(Number((await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM channels"))!.n)).toBeGreaterThan(0);
    expect(await queryOne("SELECT id FROM audit_logs WHERE action = 'demo.removed'")).not.toBeNull();

    // Idempotent: nothing left to remove.
    expect(await removeDemoData({ confirmSlug: DEMO_ORG_SLUG })).toEqual({ status: "not_found" });
  });
});
