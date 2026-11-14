import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "@/lib/master-data/demo-seed";
import { AuthorizationError } from "@/lib/data/master-data";
import { queryOne } from "@/lib/db/pool";
import type { ActiveSession } from "@/lib/auth/sessions";
import { createSession, resolveSession } from "@/lib/auth/sessions";
import { verifyPassword } from "@/lib/auth/password";
import { createOrganization, createUser, setMembership } from "@/lib/admin/users";
import {
  addMember,
  addMemberSchema,
  MemberError,
  removeMember,
  resetMemberPassword,
  updateMember,
} from "@/lib/organization/members";
import { sessionFor, setupTestDatabase } from "./helpers";

let teardown: () => Promise<void>;
let owner: ActiveSession;
let admin: ActiveSession;
let outsiderOwner: ActiveSession;

const userId = async (email: string) =>
  (await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]))!.id;
const membership = (orgId: string, uid: string) =>
  queryOne<{ role: string; status: string }>(
    "SELECT role, status FROM organization_members WHERE organization_id = ? AND user_id = ?",
    [orgId, uid],
  );
const input = (email: string, role = "viewer") => addMemberSchema.parse({ email, fullName: "Tim Uray", role });

beforeAll(async () => {
  ({ teardown } = await setupTestDatabase("members"));
  await seedDemo({ withUsers: true });
  owner = await sessionFor(await userId("owner.demo@uray.local"));
  admin = await sessionFor(await userId("admin.demo@uray.local"));
  await createOrganization({ name: "Other Org (TEST)", slug: "other-members", isDemo: true });
  await createUser({ email: "outsider@members.test", password: "MaduHutan2026" });
  await setMembership({ organizationSlug: "other-members", email: "outsider@members.test", role: "owner" });
  outsiderOwner = await sessionFor(await userId("outsider@members.test"));
});
afterAll(() => teardown());

describe("Owner manages dashboard access", () => {
  it("only the Owner can add members", async () => {
    await expect(addMember(admin, input("x@uray.test"))).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("validates the email and role", () => {
    expect(addMemberSchema.safeParse({ email: "bukan-email", role: "viewer" }).success).toBe(false);
    expect(addMemberSchema.safeParse({ email: "a@b.co", role: "superadmin" }).success).toBe(false);
    expect(addMemberSchema.parse({ email: "  Tim@Uray.TEST ", role: "analyst" }).email).toBe("tim@uray.test");
  });

  it("creates a new account with a one-time temporary password that must be changed", async () => {
    const result = await addMember(owner, input("baru@uray.test", "analyst"), "192.0.2.20");
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    const user = await queryOne<{ id: string; password_hash: string; must_change_password: number; full_name: string }>(
      "SELECT id, password_hash, must_change_password, full_name FROM users WHERE email = 'baru@uray.test'",
    );
    expect(user!.must_change_password).toBe(1);
    expect(user!.full_name).toBe("Tim Uray");
    expect(user!.password_hash).not.toContain(result.temporaryPassword);
    expect(await verifyPassword(result.temporaryPassword, user!.password_hash)).toBe(true);
    expect(await membership(owner.organization.id, user!.id)).toEqual({ role: "analyst", status: "active" });

    const { token } = await createSession(user!.id);
    const state = await resolveSession(token);
    expect(state.status).toBe("active");
    if (state.status === "active") expect(state.organization.id).toBe(owner.organization.id);

    const audit = await queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE organization_id = ? AND action IN ('user.created','member.added') AND entity_id = ?",
      [owner.organization.id, user!.id],
    );
    expect(Number(audit!.n)).toBe(2);
  });

  it("adds an existing account without touching its password, and refuses duplicates", async () => {
    const before = await queryOne<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email = 'outsider@members.test'",
    );
    expect(await addMember(owner, input("outsider@members.test"))).toEqual({
      status: "added_existing",
      email: "outsider@members.test",
    });
    const after = await queryOne<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email = 'outsider@members.test'",
    );
    expect(after!.password_hash).toBe(before!.password_hash);
    await expect(addMember(owner, input("outsider@members.test"))).rejects.toBeInstanceOf(MemberError);
  });

  it("changes role, suspends (access stops at once) and reactivates", async () => {
    const uid = await userId("baru@uray.test");
    await updateMember(owner, uid, { role: "viewer", status: "suspended" });
    expect(await membership(owner.organization.id, uid)).toEqual({ role: "viewer", status: "suspended" });
    const { token } = await createSession(uid);
    expect((await resolveSession(token)).status).toBe("no_access");
    await updateMember(owner, uid, { role: "admin", status: "active" });
    expect((await resolveSession(token)).status).toBe("active");
  });

  it("cannot change its own membership, members of other organizations, or remove the last Owner", async () => {
    await expect(updateMember(owner, owner.user.id, { role: "viewer", status: "active" })).rejects.toBeInstanceOf(
      MemberError,
    );
    await expect(removeMember(owner, owner.user.id)).rejects.toBeInstanceOf(MemberError);
    // Tenant isolation: the other org's Owner cannot touch the DEMO admin.
    await expect(
      updateMember(outsiderOwner, admin.user.id, { role: "viewer", status: "active" }),
    ).rejects.toBeInstanceOf(MemberError);
    // A second Owner may not demote the only other active Owner below one.
    const second = await userId("baru@uray.test");
    await updateMember(owner, second, { role: "owner", status: "active" });
    const secondSession = await sessionFor(second);
    await updateMember(secondSession, owner.user.id, { role: "admin", status: "active" });
    // `second` is now the only active Owner: cannot be removed.
    await expect(removeMember(owner, second)).rejects.toBeInstanceOf(MemberError);
    await expect(updateMember(secondSession, second, { role: "admin", status: "active" })).rejects.toBeInstanceOf(
      MemberError,
    );
    await updateMember(secondSession, owner.user.id, { role: "owner", status: "active" });
  });

  it("resets a temporary password only for accounts used in this organization alone", async () => {
    const uid = await userId("baru@uray.test");
    const { token } = await createSession(uid);
    const reset = await resetMemberPassword(owner, uid);
    expect(reset.email).toBe("baru@uray.test");
    const user = await queryOne<{ password_hash: string; must_change_password: number }>(
      "SELECT password_hash, must_change_password FROM users WHERE id = ?",
      [uid],
    );
    expect(await verifyPassword(reset.temporaryPassword, user!.password_hash)).toBe(true);
    expect(user!.must_change_password).toBe(1);
    expect((await resolveSession(token)).status).toBe("unauthenticated");

    await expect(resetMemberPassword(owner, outsiderOwner.user.id)).rejects.toBeInstanceOf(MemberError);
  });

  it("removes access but keeps the account and its other organizations", async () => {
    await removeMember(owner, outsiderOwner.user.id, "192.0.2.21");
    expect(await membership(owner.organization.id, outsiderOwner.user.id)).toBeNull();
    expect(await membership(outsiderOwner.organization.id, outsiderOwner.user.id)).toEqual({
      role: "owner",
      status: "active",
    });
    const audit = await queryOne(
      "SELECT id FROM audit_logs WHERE organization_id = ? AND action = 'member.removed' AND entity_id = ?",
      [owner.organization.id, outsiderOwner.user.id],
    );
    expect(audit).not.toBeNull();
  });
});
