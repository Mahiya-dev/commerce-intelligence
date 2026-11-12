import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "@/lib/master-data/demo-seed";
import { seedDemoSales } from "@/lib/master-data/demo-sales";
import { queryOne } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { createOrganization, createUser, setMembership } from "@/lib/admin/users";
import { getPortfolioOverview, getProductDetail } from "@/lib/data/portfolio";
import { sessionFor, setupTestDatabase } from "./helpers";

const NOW = new Date("2026-11-11T03:00:00Z");
const TODAY = "2026-11-11";

let teardown: () => Promise<void>;
let viewer: ActiveSession;
let outsider: ActiveSession;
const userId = async (email: string) =>
  (await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]))!.id;
const count = async (sql: string) => Number((await queryOne<{ n: number }>(sql))!.n);

beforeAll(async () => {
  ({ teardown } = await setupTestDatabase("portfolio"));
  await seedDemo({ withUsers: true });
  const first = await seedDemoSales(join(process.cwd(), "samples"), NOW);
  expect(first.every((r) => r.outcome === "committed")).toBe(true);
  const again = await seedDemoSales(join(process.cwd(), "samples"), NOW);
  expect(again.every((r) => r.outcome === "already_committed")).toBe(true);
  viewer = await sessionFor(await userId("viewer.demo@uray.local"));
  await createOrganization({ name: "Other Org (TEST)", slug: "other-portfolio", isDemo: true });
  await createUser({ email: "outsider@portfolio.test", password: "MaduHutan2026" });
  await setMembership({ organizationSlug: "other-portfolio", email: "outsider@portfolio.test", role: "owner" });
  outsider = await sessionFor(await userId("outsider@portfolio.test"));
}, 120_000);
afterAll(() => teardown());

describe("Phase 3 DEMO data", () => {
  it("imports 12 months of shop, product and touchpoint facts", async () => {
    expect(await count("SELECT COUNT(DISTINCT DATE_FORMAT(fact_date, '%Y-%m')) AS n FROM listing_daily_facts")).toBe(
      12,
    );
    expect(await count("SELECT COUNT(*) AS n FROM touchpoint_daily_facts")).toBe(13447);
    // Touchpoints reconcile exactly with product facts.
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM listing_daily_facts f
          LEFT JOIN (SELECT listing_id, fact_date, SUM(gmv) AS gmv FROM touchpoint_daily_facts GROUP BY listing_id, fact_date) t
            ON t.listing_id = f.listing_id AND t.fact_date = f.fact_date
          WHERE t.gmv IS NULL OR t.gmv <> f.gmv`,
      ),
    ).toBe(0);
  });
});

describe("portfolio read model", () => {
  it("builds the matrix, history and recommendations from the database", async () => {
    const o = await getPortfolioOverview(viewer, { month: "2026-10", today: TODAY });
    if (o.status !== "ok") throw new Error("empty");
    expect(o.asOf).toBe("2026-11-10");
    expect(o.months[0]).toBe("2025-12");
    expect(o.matrix.activeSkus).toBe(6);
    const q = Object.fromEntries(o.matrix.rows.map((r) => [r.sku, r.quadrant]));
    expect(q["MU-RANDU-500"]).toBe("evaluasi");
    expect(q["MU-KLC-150"]).toBe("potensial");
    expect(o.recommendations["MU-RANDU-500"].map((r) => r.title)).toContain("Biaya Iklan hampir tidak kembali");
    expect(o.history.rows.find((r) => r.sku === "MU-HUTAN-250")!.quadrants[1]).toBe("penopang");
    expect(o.unmapped.listings).toBe(2);
  });

  it("product detail: trend, touchpoints and listings", async () => {
    const d = await getProductDetail(viewer, "MU-HUTAN-500", { month: "2026-10", today: TODAY });
    if (d.status !== "ok") throw new Error(d.status);
    expect(d.trend).toHaveLength(12);
    expect(d.listings).toHaveLength(3);
    expect(d.touchpoints.reduce((s, t) => s + t.gmv, 0)).toBe(d.row!.current.gmv);
    expect(await getProductDetail(viewer, "NOPE-1", { today: TODAY })).toEqual({ status: "not_found" });
  });

  it("is tenant-scoped", async () => {
    expect(await getPortfolioOverview(outsider, { today: TODAY })).toEqual({ status: "empty" });
    expect(await getProductDetail(outsider, "MU-HUTAN-500", { today: TODAY })).toEqual({ status: "not_found" });
  });
});
