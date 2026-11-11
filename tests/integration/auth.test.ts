import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticate } from "@/lib/auth/login";
import { createSession, resolveSession, revokeSession } from "@/lib/auth/sessions";
import {
  changeOwnPassword,
  createOrganization,
  createUser,
  resetPassword,
  setMembership,
  setUserStatus,
} from "@/lib/admin/users";
import { execute, queryOne } from "@/lib/db/pool";
import { SESSION_POLICY } from "@/lib/auth/constants";
import { setupTestDatabase } from "./helpers";

let teardown: () => Promise<void>;
const PW = "MaduHutan2026";

beforeAll(async () => {
  ({ teardown } = await setupTestDatabase("auth"));
  await createOrganization({ name: "Org A", slug: "org-a" });
  await createUser({ email: "owner@a.test", fullName: "Owner A", password: PW });
  await setMembership({ organizationSlug: "org-a", email: "owner@a.test", role: "owner" });
  await createUser({ email: "lonely@a.test", password: PW });
});
afterAll(() => teardown());

describe("authenticate", () => {
  it("accepts correct credentials case-insensitively on email", async () => {
    const r = await authenticate("Owner@A.test", PW, "10.0.0.1");
    expect(r).toMatchObject({ ok: true, mustChangePassword: true });
  });

  it("rejects wrong password and unknown email with the same reason", async () => {
    expect(await authenticate("owner@a.test", "wrong", "10.0.0.2")).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
    expect(await authenticate("ghost@a.test", PW, "10.0.0.2")).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("throttles an email after 5 failures, even with the right password", async () => {
    await createUser({ email: "target@a.test", password: PW });
    for (let i = 0; i < 5; i++) await authenticate("target@a.test", "nope", `10.1.0.${i}`);
    expect(await authenticate("target@a.test", PW, "10.1.0.9")).toEqual({ ok: false, reason: "throttled" });
  });

  it("rejects disabled accounts and revokes their sessions", async () => {
    await createUser({ email: "leaver@a.test", password: PW });
    await setMembership({ organizationSlug: "org-a", email: "leaver@a.test", role: "viewer" });
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE email = 'leaver@a.test'");
    const { token } = await createSession(user!.id);
    await setUserStatus("leaver@a.test", "disabled");
    expect(await authenticate("leaver@a.test", PW, null)).toEqual({ ok: false, reason: "invalid_credentials" });
    expect((await resolveSession(token)).status).toBe("unauthenticated");
  });

  it("never stores emails or passwords in clear in login_attempts / audit_logs", async () => {
    const leaked = await queryOne<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM login_attempts WHERE email_hash LIKE '%@%')
            + (SELECT COUNT(*) FROM audit_logs WHERE new_data LIKE '%MaduHutan2026%' OR old_data LIKE '%MaduHutan2026%') AS n`,
    );
    expect(Number(leaked!.n)).toBe(0);
  });
});

describe("sessions", () => {
  const ownerId = async () => (await queryOne<{ id: string }>("SELECT id FROM users WHERE email = 'owner@a.test'"))!.id;

  it("resolves an active session with organization and role", async () => {
    const { token } = await createSession(await ownerId());
    const s = await resolveSession(token);
    expect(s.status).toBe("active");
    if (s.status === "active") {
      expect(s.role).toBe("owner");
      expect(s.organization.slug).toBe("org-a");
      expect(s.user.mustChangePassword).toBe(true);
    }
  });

  it("stores only a hash of the token", async () => {
    const { token } = await createSession(await ownerId());
    expect(await queryOne("SELECT id FROM sessions WHERE id = ?", [token])).toBeNull();
  });

  it("rejects garbage, revoked, idle-expired and absolute-expired sessions", async () => {
    expect((await resolveSession(undefined)).status).toBe("unauthenticated");
    expect((await resolveSession("x".repeat(40))).status).toBe("unauthenticated");

    const a = await createSession(await ownerId());
    await revokeSession(a.token);
    expect((await resolveSession(a.token)).status).toBe("unauthenticated");

    const b = await createSession(await ownerId());
    const afterIdle = new Date(Date.now() + (SESSION_POLICY.idleMinutes + 1) * 60_000);
    expect((await resolveSession(b.token, undefined, afterIdle)).status).toBe("unauthenticated");

    const c = await createSession(await ownerId());
    const afterAbsolute = new Date(Date.now() + (SESSION_POLICY.absoluteDays * 24 + 1) * 3_600_000);
    expect((await resolveSession(c.token, undefined, afterAbsolute)).status).toBe("unauthenticated");
  });

  it("slides the idle expiry on activity", async () => {
    const { token } = await createSession(await ownerId());
    const later = new Date(Date.now() + 60 * 60_000); // 1h later, still valid
    expect((await resolveSession(token, undefined, later)).status).toBe("active");
    const row = await queryOne<{ idle_expires_at: Date }>(
      "SELECT idle_expires_at FROM sessions ORDER BY created_at DESC LIMIT 1",
    );
    expect(row!.idle_expires_at.getTime()).toBeGreaterThan(later.getTime() + (SESSION_POLICY.idleMinutes - 1) * 60_000);
  });

  it("returns no_access for users without an active membership", async () => {
    const lonely = await queryOne<{ id: string }>("SELECT id FROM users WHERE email = 'lonely@a.test'");
    const { token } = await createSession(lonely!.id);
    expect((await resolveSession(token)).status).toBe("no_access");

    await setMembership({ organizationSlug: "org-a", email: "lonely@a.test", role: "viewer", status: "suspended" });
    expect((await resolveSession(token)).status).toBe("no_access");
  });
});

describe("password lifecycle", () => {
  it("change requires the current password, rejects reuse, clears the forced-change flag and revokes other sessions", async () => {
    const { userId } = await createUser({ email: "changer@a.test", password: PW });
    const keep = await createSession(userId);
    const other = await createSession(userId);
    const actor = { userId };

    expect(await changeOwnPassword({ userId, currentPassword: "bad", newPassword: "BaruSekali2026" }, actor)).toEqual({
      ok: false,
      reason: "wrong_current",
    });
    expect(await changeOwnPassword({ userId, currentPassword: PW, newPassword: PW }, actor)).toEqual({
      ok: false,
      reason: "same_as_current",
    });
    expect(await changeOwnPassword({ userId, currentPassword: PW, newPassword: "weak" }, actor)).toEqual({
      ok: false,
      reason: "weak",
    });
    expect(
      await changeOwnPassword(
        { userId, currentPassword: PW, newPassword: "BaruSekali2026", keepSessionToken: keep.token },
        actor,
      ),
    ).toEqual({ ok: true });

    expect((await authenticate("changer@a.test", "BaruSekali2026", null)).ok).toBe(true);
    expect(
      await queryOne("SELECT id FROM sessions WHERE user_id = ? AND id = SHA2(?, 256)", [userId, other.token]),
    ).toBeNull();
    const flag = await queryOne<{ must_change_password: number }>(
      "SELECT must_change_password FROM users WHERE id = ?",
      [userId],
    );
    expect(flag!.must_change_password).toBe(0);
  });

  it("admin reset issues a new temporary password and forces a change", async () => {
    const { userId } = await createUser({ email: "forgot@a.test", password: PW });
    await execute("UPDATE users SET must_change_password = 0 WHERE id = ?", [userId]);
    const temp = await resetPassword("forgot@a.test");
    expect((await authenticate("forgot@a.test", PW, null)).ok).toBe(false);
    expect(await authenticate("forgot@a.test", temp, null)).toMatchObject({ ok: true, mustChangePassword: true });
  });
});
