import { createHash, randomBytes } from "node:crypto";
import { execute, queryOne, queryRows, toSqlDateTime, type Queryable, getPool } from "@/lib/db/pool";
import { isAppRole, type AppRole } from "@/lib/auth/roles";
import { SESSION_POLICY } from "@/lib/auth/constants";

/**
 * Framework-independent session store (no next/* imports), so it can be
 * integration-tested and reused by the CLI. Cookie handling lives in session.ts.
 */

export type SessionUser = { id: string; email: string; fullName: string | null; mustChangePassword: boolean };

export type SessionOrganization = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  isDemo: boolean;
};

export type ActiveSession = {
  status: "active";
  user: SessionUser;
  organization: SessionOrganization;
  role: AppRole;
  membershipCount: number;
};

export type SessionState = { status: "unauthenticated" } | { status: "no_access"; user: SessionUser } | ActiveSession;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  db: Queryable = getPool(),
  now: Date = new Date(),
): Promise<{ token: string; absoluteExpiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const idle = new Date(now.getTime() + SESSION_POLICY.idleMinutes * 60_000);
  const absolute = new Date(now.getTime() + SESSION_POLICY.absoluteDays * 86_400_000);
  await execute(
    `INSERT INTO sessions (id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      hashToken(token),
      userId,
      toSqlDateTime(now),
      toSqlDateTime(now),
      toSqlDateTime(idle),
      toSqlDateTime(absolute),
      meta.ipAddress ?? null,
      meta.userAgent?.slice(0, 255) ?? null,
    ],
    db,
  );
  return { token, absoluteExpiresAt: absolute };
}

type SessionLookupRow = {
  session_id: string;
  last_seen_at: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  user_id: string;
  email: string;
  full_name: string | null;
  must_change_password: number;
  user_status: "active" | "disabled";
};

type MembershipLookupRow = {
  role: string;
  org_id: string;
  org_name: string;
  org_slug: string;
  org_timezone: string;
  org_currency: string;
  org_is_demo: number;
};

/**
 * Resolves a raw cookie token to a session state. Expired sessions and
 * disabled users resolve to "unauthenticated". Active organization (Phase 1):
 * the earliest active membership.
 */
export async function resolveSession(
  token: string | undefined,
  db: Queryable = getPool(),
  now: Date = new Date(),
): Promise<SessionState> {
  if (!token || token.length < 32 || token.length > 128) return { status: "unauthenticated" };
  const id = hashToken(token);

  const row = await queryOne<SessionLookupRow>(
    `SELECT s.id AS session_id, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at,
            u.id AS user_id, u.email, u.full_name, u.must_change_password, u.status AS user_status
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    [id],
    db,
  );
  if (!row) return { status: "unauthenticated" };

  if (row.user_status !== "active" || row.idle_expires_at <= now || row.absolute_expires_at <= now) {
    await execute("DELETE FROM sessions WHERE id = ?", [id], db);
    return { status: "unauthenticated" };
  }

  // Sliding idle expiry, written at most every touchIntervalMinutes.
  if (now.getTime() - row.last_seen_at.getTime() > SESSION_POLICY.touchIntervalMinutes * 60_000) {
    const idle = new Date(now.getTime() + SESSION_POLICY.idleMinutes * 60_000);
    await execute(
      "UPDATE sessions SET last_seen_at = ?, idle_expires_at = LEAST(?, absolute_expires_at) WHERE id = ?",
      [toSqlDateTime(now), toSqlDateTime(idle), id],
      db,
    );
  }

  const user: SessionUser = {
    id: row.user_id,
    email: row.email,
    fullName: row.full_name,
    mustChangePassword: row.must_change_password === 1,
  };

  const memberships = await queryRows<MembershipLookupRow>(
    `SELECT m.role, o.id AS org_id, o.name AS org_name, o.slug AS org_slug, o.timezone AS org_timezone,
            o.currency AS org_currency, o.is_demo AS org_is_demo
       FROM organization_members m JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY m.created_at ASC, o.id ASC`,
    [user.id],
    db,
  );

  const first = memberships[0];
  if (!first || !isAppRole(first.role)) return { status: "no_access", user };

  return {
    status: "active",
    user,
    role: first.role,
    membershipCount: memberships.length,
    organization: {
      id: first.org_id,
      name: first.org_name,
      slug: first.org_slug,
      timezone: first.org_timezone,
      currency: first.org_currency,
      isDemo: first.org_is_demo === 1,
    },
  };
}

export async function revokeSession(token: string, db: Queryable = getPool()): Promise<void> {
  await execute("DELETE FROM sessions WHERE id = ?", [hashToken(token)], db);
}

/** Revoke every session of a user, optionally keeping the current one. */
export async function revokeUserSessions(userId: string, exceptToken?: string, db: Queryable = getPool()) {
  if (exceptToken) {
    await execute("DELETE FROM sessions WHERE user_id = ? AND id <> ?", [userId, hashToken(exceptToken)], db);
  } else {
    await execute("DELETE FROM sessions WHERE user_id = ?", [userId], db);
  }
}

/** Housekeeping: remove expired sessions and old login attempts. */
export async function purgeExpiredAuthData(db: Queryable = getPool(), now: Date = new Date()) {
  const ts = toSqlDateTime(now);
  const sessions = await execute(
    "DELETE FROM sessions WHERE idle_expires_at <= ? OR absolute_expires_at <= ?",
    [ts, ts],
    db,
  );
  const attempts = await execute(
    "DELETE FROM login_attempts WHERE attempted_at < ?",
    [toSqlDateTime(new Date(now.getTime() - 30 * 86_400_000))],
    db,
  );
  return { sessions: sessions.affectedRows, loginAttempts: attempts.affectedRows };
}
