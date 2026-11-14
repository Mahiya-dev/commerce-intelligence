import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { z } from "zod";
import { execute, queryOne, queryRows, toSqlDateTime, withTransaction } from "@/lib/db/pool";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { revokeUserSessions } from "@/lib/auth/sessions";
import { can, isAppRole, ROLES, type AppRole } from "@/lib/auth/roles";
import type { ActiveSession } from "@/lib/auth/sessions";
import { AuthorizationError } from "@/lib/data/master-data";
import { writeAudit } from "@/lib/audit";

/**
 * Owner-managed access to the dashboard ("members:manage"): add a user (new
 * account with a one-time temporary password, or an existing account), change
 * role, suspend/reactivate, remove, and reset the temporary password.
 *
 * Every operation is scoped to the session's organization, runs in one
 * transaction with its audit record, and keeps at least one active Owner.
 * Owners cannot change their own membership here (no accidental lock-out).
 * Suspension/removal takes effect on the member's next request: the session
 * resolver only accepts active memberships.
 */

export class MemberError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "MemberError";
  }
}

export const addMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Email terlalu panjang.")
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Email tidak valid."),
  fullName: z.string().trim().max(150, "Nama maksimal 150 karakter.").optional().default(""),
  role: z.enum(ROLES, { error: "Pilih peran." }),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export type AddMemberResult =
  { status: "created"; email: string; temporaryPassword: string } | { status: "added_existing"; email: string };

function assertOwner(session: ActiveSession) {
  if (!can(session.role, "members:manage")) throw new AuthorizationError("owner");
}

async function activeOwners(conn: PoolConnection, organizationId: string) {
  return queryRows<{ user_id: string }>(
    "SELECT user_id FROM organization_members WHERE organization_id = ? AND role = 'owner' AND status = 'active' FOR UPDATE",
    [organizationId],
    conn,
  );
}

async function lockMember(conn: PoolConnection, session: ActiveSession, userId: string) {
  if (userId === session.user.id) {
    throw new MemberError("Anda tidak dapat mengubah akses akun Anda sendiri. Minta Owner lain.");
  }
  // Lock owners first, then the member row: same order as src/lib/admin/users.ts.
  const owners = await activeOwners(conn, session.organization.id);
  const member = await queryOne<{ role: AppRole; status: "active" | "suspended"; email: string }>(
    `SELECT m.role, m.status, u.email FROM organization_members m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ? AND m.user_id = ? FOR UPDATE`,
    [session.organization.id, userId],
    conn,
  );
  if (!member) throw new MemberError("Pengguna bukan anggota organisasi ini.");
  return { owners, member };
}

export async function addMember(
  session: ActiveSession,
  input: AddMemberInput,
  ipAddress: string | null = null,
): Promise<AddMemberResult> {
  assertOwner(session);
  const orgId = session.organization.id;
  const temporaryPassword = generateTemporaryPassword();
  const hash = await hashPassword(temporaryPassword);

  return withTransaction(async (conn) => {
    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE email = ? FOR UPDATE",
      [input.email],
      conn,
    );
    let userId: string;
    if (existing) {
      userId = existing.id;
      const member = await queryOne(
        "SELECT 1 AS x FROM organization_members WHERE organization_id = ? AND user_id = ?",
        [orgId, userId],
        conn,
      );
      if (member) throw new MemberError("Pengguna ini sudah menjadi anggota organisasi.", "email");
    } else {
      userId = randomUUID();
      await execute(
        "INSERT INTO users (id, email, full_name, password_hash, must_change_password) VALUES (?, ?, ?, ?, 1)",
        [userId, input.email, input.fullName || null, hash],
        conn,
      );
      await writeAudit(conn, {
        organizationId: orgId,
        actorUserId: session.user.id,
        action: "user.created",
        entityType: "user",
        entityId: userId,
        newData: { email: input.email, full_name: input.fullName || null },
        ipAddress,
      });
    }

    await execute(
      "INSERT INTO organization_members (organization_id, user_id, role, status, invited_by) VALUES (?, ?, ?, 'active', ?)",
      [orgId, userId, input.role, session.user.id],
      conn,
    );
    await writeAudit(conn, {
      organizationId: orgId,
      actorUserId: session.user.id,
      action: "member.added",
      entityType: "organization_member",
      entityId: userId,
      newData: { email: input.email, role: input.role, status: "active" },
      ipAddress,
    });
    return existing
      ? { status: "added_existing", email: input.email }
      : { status: "created", email: input.email, temporaryPassword };
  });
}

export async function updateMember(
  session: ActiveSession,
  userId: string,
  change: { role: AppRole; status: "active" | "suspended" },
  ipAddress: string | null = null,
): Promise<void> {
  assertOwner(session);
  if (!isAppRole(change.role)) throw new MemberError("Peran tidak valid.");
  if (change.status !== "active" && change.status !== "suspended") throw new MemberError("Status tidak valid.");

  await withTransaction(async (conn) => {
    const { owners, member } = await lockMember(conn, session, userId);
    const wasActiveOwner = member.role === "owner" && member.status === "active";
    const staysActiveOwner = change.role === "owner" && change.status === "active";
    if (wasActiveOwner && !staysActiveOwner && owners.length <= 1) {
      throw new MemberError("Organisasi harus memiliki minimal satu Owner aktif.");
    }
    if (member.role === change.role && member.status === change.status) return;

    await execute(
      "UPDATE organization_members SET role = ?, status = ? WHERE organization_id = ? AND user_id = ?",
      [change.role, change.status, session.organization.id, userId],
      conn,
    );
    await writeAudit(conn, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      action: "member.updated",
      entityType: "organization_member",
      entityId: userId,
      oldData: { role: member.role, status: member.status },
      newData: change,
      ipAddress,
    });
  });
}

export async function removeMember(
  session: ActiveSession,
  userId: string,
  ipAddress: string | null = null,
): Promise<void> {
  assertOwner(session);
  await withTransaction(async (conn) => {
    const { owners, member } = await lockMember(conn, session, userId);
    if (member.role === "owner" && member.status === "active" && owners.length <= 1) {
      throw new MemberError("Organisasi harus memiliki minimal satu Owner aktif.");
    }
    await execute(
      "DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?",
      [session.organization.id, userId],
      conn,
    );
    await writeAudit(conn, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      action: "member.removed",
      entityType: "organization_member",
      entityId: userId,
      oldData: { email: member.email, role: member.role, status: member.status },
      ipAddress,
    });
  });
}

/**
 * New temporary password (shown once), forced change at next sign-in, all
 * sessions revoked. Only for accounts that belong to this organization alone:
 * an Owner must not take over an account used in another organization.
 */
export async function resetMemberPassword(
  session: ActiveSession,
  userId: string,
  ipAddress: string | null = null,
): Promise<{ email: string; temporaryPassword: string }> {
  assertOwner(session);
  const temporaryPassword = generateTemporaryPassword();
  const hash = await hashPassword(temporaryPassword);

  return withTransaction(async (conn) => {
    const { member } = await lockMember(conn, session, userId);
    const other = await queryOne(
      "SELECT 1 AS x FROM organization_members WHERE user_id = ? AND organization_id <> ? LIMIT 1",
      [userId, session.organization.id],
      conn,
    );
    if (other) {
      throw new MemberError(
        "Akun ini juga dipakai di organisasi lain; reset kata sandi hanya lewat administrator sistem.",
      );
    }
    await execute(
      "UPDATE users SET password_hash = ?, must_change_password = 1, password_changed_at = ? WHERE id = ?",
      [hash, toSqlDateTime(new Date()), userId],
      conn,
    );
    await revokeUserSessions(userId, undefined, conn);
    await writeAudit(conn, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      action: "user.password_reset",
      entityType: "user",
      entityId: userId,
      ipAddress,
    });
    return { email: member.email, temporaryPassword };
  });
}
