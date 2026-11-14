import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "@/lib/master-data/demo-seed";
import { AuthorizationError } from "@/lib/data/master-data";
import { queryOne } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { createOrganization, createUser, setMembership } from "@/lib/admin/users";
import {
  DEFAULT_KPI_SETTINGS,
  getKpiSettings,
  organizationSettingsSchema,
  updateOrganizationSettings,
} from "@/lib/organization/settings";
import { expectDbError, CHECK_VIOLATION, sessionFor, setupTestDatabase } from "./helpers";
import { execute } from "@/lib/db/pool";

let teardown: () => Promise<void>;
let owner: ActiveSession;
let admin: ActiveSession;
let outsider: ActiveSession;

const userId = async (email: string) =>
  (await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]))!.id;

const input = (patch: Record<string, string> = {}) =>
  organizationSettingsSchema.parse({
    name: "Madu Uray (DEMO) Baru",
    timezone: "Asia/Makassar",
    onTrackPct: "85",
    watchPct: "60",
    targetConversionPct: "3,5",
    targetAov: "120.000",
    defaultRange: "30d",
    portfolioShareFactor: "1,5",
    portfolioGrowthPct: "-5",
    ...patch,
  });

beforeAll(async () => {
  ({ teardown } = await setupTestDatabase("org_settings"));
  await seedDemo({ withUsers: true });
  owner = await sessionFor(await userId("owner.demo@uray.local"));
  admin = await sessionFor(await userId("admin.demo@uray.local"));
  await createOrganization({ name: "Other Org (TEST)", slug: "other-settings", isDemo: true });
  await createUser({ email: "outsider@settings.test", password: "MaduHutan2026" });
  await setMembership({ organizationSlug: "other-settings", email: "outsider@settings.test", role: "owner" });
  outsider = await sessionFor(await userId("outsider@settings.test"));
});
afterAll(() => teardown());

describe("organization settings", () => {
  it("defaults apply until the Owner saves", async () => {
    expect(await getKpiSettings(admin)).toEqual(DEFAULT_KPI_SETTINGS);
  });

  it("only the Owner can change settings", async () => {
    await expect(updateOrganizationSettings(admin, input())).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("Owner updates profile + KPI settings in one audited transaction", async () => {
    await updateOrganizationSettings(owner, input(), "192.0.2.10");

    const org = await queryOne<{ name: string; timezone: string }>(
      "SELECT name, timezone FROM organizations WHERE id = ?",
      [owner.organization.id],
    );
    expect(org).toEqual({ name: "Madu Uray (DEMO) Baru", timezone: "Asia/Makassar" });
    expect(await getKpiSettings(admin)).toMatchObject({
      thresholds: { onTrack: 0.85, watch: 0.6 },
      targetConversionRate: 0.035,
      targetAov: 120000,
      defaultRange: "30d",
      portfolio: { shareFactor: 1.5, growthThreshold: -0.05 },
    });

    const audit = await queryOne<{ n: number; new_data: unknown }>(
      `SELECT COUNT(*) AS n, MAX(new_data) AS new_data FROM audit_logs
        WHERE action = 'organization.settings_updated' AND organization_id = ?`,
      [owner.organization.id],
    );
    expect(Number(audit?.n)).toBe(1);

    // Saving the same values again is not audited as a change.
    await updateOrganizationSettings(owner, input());
    const again = await queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'organization.settings_updated' AND organization_id = ?",
      [owner.organization.id],
    );
    expect(Number(again?.n)).toBe(1);

    // Clearing optional targets stores NULL, not zero.
    await updateOrganizationSettings(owner, input({ targetConversionPct: "", targetAov: "" }));
    expect(await getKpiSettings(owner)).toMatchObject({ targetConversionRate: null, targetAov: null });
  });

  it("settings are tenant-scoped", async () => {
    expect(await getKpiSettings(outsider)).toEqual(DEFAULT_KPI_SETTINGS);
  });

  it("database rejects inconsistent thresholds", async () => {
    await expectDbError(
      execute(
        "INSERT INTO organization_kpi_settings (organization_id, on_track_threshold, watch_threshold) VALUES (?, 0.5, 0.8)",
        [outsider.organization.id],
      ),
      [CHECK_VIOLATION],
    );
  });
});
