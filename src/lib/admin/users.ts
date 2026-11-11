import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { execute, queryOne, queryRows, withTransaction, toSqlDateTime } from "@/lib/db/pool";
import { generateTemporaryPassword, hashPassword, verifyPassword } from "@/lib/auth/password";
import { revokeUserSessions } from "@/lib/auth/sessions";
import { isAppRole, type AppRole } from "@/lib/auth/roles";
import { writeAudit } from "@/lib/audit";
import { newPasswordSchema } from "@/lib/auth/schemas";

/**
 * Administrative operations shared by the CLI (src/cli/admin.ts) and, in later
 * phases, the admin UI. MySQL has no row-level security or auth service, so every
 * mutation runs in a transaction and writes its audit record in the same
 * transaction.
 */

export class AdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminError";
  }
}

export type Actor = { userId: string | null; ipAddress?: string | null };
const SYSTEM: Actor = { userId: null };

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export async function createOrganization(
  input: { name: string; slug: string; timezone?: string; currency?: string; isDemo?: boolean },
  actor: Actor = SYSTEM,
): Promise<string> {
  if (!SLUG_RE.test(input.slug)) throw new AdminError("Slug hanya boleh huruf kecil, angka dan tanda hubung.");
  return withTransaction(async (conn) => {
    const existing = await queryOne<{ id: string }>("SELECT id FROM organizations WHERE slug = ?", [input.slug], conn);
    if (existing) throw new AdminError(`Organisasi dengan slug ${input.slug} sudah ada.`);
    const id = randomUUID();
    const row = {
      id,
      name: input.name.trim(),
      slug: input.slug,
      timezone: input.timezone ?? "Asia/Jakarta",
      currency: input.currency ?? "IDR",
      is_demo: input.isDemo ? 1 : 0,
    };
    await execute(
      "INSERT INTO organizations (id, name, slug, timezone, currency, is_demo) VALUES (?, ?, ?, ?, ?, ?)",
      [row.id, row.name, row.slug, row.timezone, row.currency, row.is_demo],
      conn,
    );
    await writeAudit(conn, {
      organizationId: id,
      actorUserId: actor.userId,
      action: "organization.created",
      entityType: "organization",
      entityId: id,
      newData: row,
      ipAddress: actor.ipAddress,
    });
    return id;
  });
}

function normaliseEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) throw new AdminError("Email tidak valid.");
  return e;
}

/**
 * Creates a user with a temporary password (returned once, never stored in
 * clear). The user must change it at first sign-in.
 */
export async function createUser(
  input: { email: string; fullName?: string | null; password?: string },
  actor: Actor = SYSTEM,
): Promise<{ userId: string; email: string; temporaryPassword: string }> {
  const email = normaliseEmail(input.email);
  const temporaryPassword = input.password ?? generateTemporaryPassword();
  const hash = await hashPassword(temporaryPassword);

  const userId = await withTransaction(async (conn) => {
    const existing = await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email], conn);
    if (existing) throw new AdminError(`Pengguna ${email} sudah ada.`);
    const id = randomUUID();
    await execute(
      "INSERT INTO users (id, email, full_name, password_hash, must_change_password) VALUES (?, ?, ?, ?, 1)",
      [id, email, input.fullName?.trim() || null, hash],
      conn,
    );
    await writeAudit(conn, {
      organizationId: null,
      actorUserId: actor.userId,
      action: "user.created",
      entityType: "user",
      entityId: id,
      newData: { email, full_name: input.fullName ?? null },
      ipAddress: actor.ipAddress,
    });
    return id;
  });
  return { userId, email, temporaryPassword };
}

async function lockOrganizationOwners(conn: PoolConnection, organizationId: string) {
  return queryRows<{ user_id: string }>(
    "SELECT user_id FROM organization_members WHERE organization_id = ? AND role = 'owner' AND status = 'active' FOR UPDATE",
    [organizationId],
    conn,
  );
}

/**
 * Grants/changes a membership. Enforces: an organization always keeps at least
 * one active owner (row locks prevent concurrent demotions from racing).
 */
export async function setMembership(
  input: { organizationSlug: string; email: string; role: AppRole; status?: "active" | "suspended" },
  actor: Actor = SYSTEM,
): Promise<void> {
  if (!isAppRole(input.role)) throw new AdminError("Peran tidak valid.");
  const email = normaliseEmail(input.email);
  const status = input.status ?? "active";

  await withTransaction(async (conn) => {
    const org = await queryOne<{ id: string }>(
      "SELECT id FROM organizations WHERE slug = ?",
      [input.organizationSlug],
      conn,
    );
    if (!org) throw new AdminError(`Organisasi ${input.organizationSlug} tidak ditemukan.`);
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email], conn);
    if (!user) throw new AdminError(`Pengguna ${email} tidak ditemukan. Buat pengguna terlebih dahulu.`);

    const owners = await lockOrganizationOwners(conn, org.id);
    const before = await queryOne<{ role: AppRole; status: string }>(
      "SELECT role, status FROM organization_members WHERE organization_id = ? AND user_id = ? FOR UPDATE",
      [org.id, user.id],
      conn,
    );

    const wasActiveOwner = before?.role === "owner" && before.status === "active";
    const staysActiveOwner = input.role === "owner" && status === "active";
    if (wasActiveOwner && !staysActiveOwner && owners.length <= 1) {
      throw new AdminError("Organisasi harus memiliki minimal satu Owner aktif.");
    }

    if (before && before.role === input.role && before.status === status) return; // no-op, nothing to audit

    await execute(
      `INSERT INTO organization_members (organization_id, user_id, role, status, invited_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role), status = VALUES(status)`,
      [org.id, user.id, input.role, status, actor.userId],
      conn,
    );
    await writeAudit(conn, {
      organizationId: org.id,
      actorUserId: actor.userId,
      action: before ? "member.updated" : "member.added",
      entityType: "organization_member",
      entityId: user.id,
      oldData: before ?? undefined,
      newData: { role: input.role, status },
      ipAddress: actor.ipAddress,
    });
  });
}

export async function removeMembership(input: { organizationSlug: string; email: string }, actor: Actor = SYSTEM) {
  const email = normaliseEmail(input.email);
  await withTransaction(async (conn) => {
    const row = await queryOne<{ org_id: string; user_id: string; role: AppRole; status: string }>(
      `SELECT m.organization_id AS org_id, m.user_id, m.role, m.status
         FROM organization_members m
         JOIN organizations o ON o.id = m.organization_id
         JOIN users u ON u.id = m.user_id
        WHERE o.slug = ? AND u.email = ? FOR UPDATE`,
      [input.organizationSlug, email],
      conn,
    );
    if (!row) throw new AdminError("Keanggotaan tidak ditemukan.");
    const owners = await lockOrganizationOwners(conn, row.org_id);
    if (row.role === "owner" && row.status === "active" && owners.length <= 1) {
      throw new AdminError("Organisasi harus memiliki minimal satu Owner aktif.");
    }
    await execute(
      "DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?",
      [row.org_id, row.user_id],
      conn,
    );
    await writeAudit(conn, {
      organizationId: row.org_id,
      actorUserId: actor.userId,
      action: "member.removed",
      entityType: "organization_member",
      entityId: row.user_id,
      oldData: { role: row.role, status: row.status },
      ipAddress: actor.ipAddress,
    });
  });
}

/** Admin reset: new temporary password, forced change, all sessions revoked. */
export async function resetPassword(emailInput: string, actor: Actor = SYSTEM): Promise<string> {
  const email = normaliseEmail(emailInput);
  const temporaryPassword = generateTemporaryPassword();
  const hash = await hashPassword(temporaryPassword);
  await withTransaction(async (conn) => {
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ? FOR UPDATE", [email], conn);
    if (!user) throw new AdminError(`Pengguna ${email} tidak ditemukan.`);
    await execute(
      "UPDATE users SET password_hash = ?, must_change_password = 1, password_changed_at = ? WHERE id = ?",
      [hash, toSqlDateTime(new Date()), user.id],
      conn,
    );
    await revokeUserSessions(user.id, undefined, conn);
    await writeAudit(conn, {
      organizationId: null,
      actorUserId: actor.userId,
      action: "user.password_reset",
      entityType: "user",
      entityId: user.id,
      ipAddress: actor.ipAddress,
    });
  });
  return temporaryPassword;
}

export async function setUserStatus(emailInput: string, status: "active" | "disabled", actor: Actor = SYSTEM) {
  const email = normaliseEmail(emailInput);
  await withTransaction(async (conn) => {
    const user = await queryOne<{ id: string; status: string }>(
      "SELECT id, status FROM users WHERE email = ? FOR UPDATE",
      [email],
      conn,
    );
    if (!user) throw new AdminError(`Pengguna ${email} tidak ditemukan.`);
    await execute("UPDATE users SET status = ? WHERE id = ?", [status, user.id], conn);
    if (status === "disabled") await revokeUserSessions(user.id, undefined, conn);
    await writeAudit(conn, {
      organizationId: null,
      actorUserId: actor.userId,
      action: status === "disabled" ? "user.disabled" : "user.enabled",
      entityType: "user",
      entityId: user.id,
      oldData: { status: user.status },
      newData: { status },
      ipAddress: actor.ipAddress,
    });
  });
}

export type ChangePasswordResult = { ok: true } | { ok: false; reason: "wrong_current" | "same_as_current" | "weak" };

/** Self-service change. Revokes every other session of the user. */
export async function changeOwnPassword(
  input: { userId: string; currentPassword: string; newPassword: string; keepSessionToken?: string },
  actor: Actor,
): Promise<ChangePasswordResult> {
  const policy = newPasswordSchema.safeParse({ password: input.newPassword, confirmPassword: input.newPassword });
  if (!policy.success) return { ok: false, reason: "weak" };

  const user = await queryOne<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", [
    input.userId,
  ]);
  if (!user || !(await verifyPassword(input.currentPassword, user.password_hash))) {
    return { ok: false, reason: "wrong_current" };
  }
  if (await verifyPassword(input.newPassword, user.password_hash)) return { ok: false, reason: "same_as_current" };

  const hash = await hashPassword(input.newPassword);
  await withTransaction(async (conn) => {
    await execute(
      "UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ? WHERE id = ?",
      [hash, toSqlDateTime(new Date()), input.userId],
      conn,
    );
    await revokeUserSessions(input.userId, input.keepSessionToken, conn);
    await writeAudit(conn, {
      organizationId: null,
      actorUserId: actor.userId,
      action: "user.password_changed",
      entityType: "user",
      entityId: input.userId,
      ipAddress: actor.ipAddress,
    });
  });
  return { ok: true };
}
