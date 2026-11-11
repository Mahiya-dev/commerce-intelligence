import { createHash } from "node:crypto";
import { execute, queryOne, toSqlDateTime, type Queryable, getPool } from "@/lib/db/pool";
import { DUMMY_PASSWORD_HASH, hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";
import { LOGIN_THROTTLE } from "@/lib/auth/constants";
import { writeAudit } from "@/lib/audit";

export type AuthResult =
  | { ok: true; userId: string; mustChangePassword: boolean }
  | { ok: false; reason: "invalid_credentials" | "throttled" };

export function emailHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

async function isThrottled(email: string, ip: string | null, db: Queryable, now: Date): Promise<boolean> {
  const since = toSqlDateTime(new Date(now.getTime() - LOGIN_THROTTLE.windowMinutes * 60_000));
  const byEmail = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE email_hash = ? AND succeeded = 0 AND attempted_at > ?",
    [emailHash(email), since],
    db,
  );
  if (Number(byEmail?.n ?? 0) >= LOGIN_THROTTLE.maxFailuresPerEmail) return true;
  if (!ip) return false;
  const byIp = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE ip_address = ? AND succeeded = 0 AND attempted_at > ?",
    [ip, since],
    db,
  );
  return Number(byIp?.n ?? 0) >= LOGIN_THROTTLE.maxFailuresPerIp;
}

/**
 * Verifies credentials with brute-force throttling. Responses do not reveal
 * whether an account exists (unknown emails still pay the hashing cost).
 */
export async function authenticate(
  emailInput: string,
  password: string,
  ip: string | null,
  db: Queryable = getPool(),
  now: Date = new Date(),
): Promise<AuthResult> {
  const email = emailInput.trim().toLowerCase();

  if (await isThrottled(email, ip, db, now)) {
    await writeAudit(db, {
      organizationId: null,
      actorUserId: null,
      action: "auth.login_throttled",
      entityType: "user",
      entityId: null,
      newData: { email_hash: emailHash(email) },
      ipAddress: ip,
    });
    return { ok: false, reason: "throttled" };
  }

  const user = await queryOne<{ id: string; password_hash: string; status: string; must_change_password: number }>(
    "SELECT id, password_hash, status, must_change_password FROM users WHERE email = ?",
    [email],
    db,
  );

  const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
  const succeeded = Boolean(user && valid && user.status === "active");

  await execute(
    "INSERT INTO login_attempts (email_hash, ip_address, succeeded, attempted_at) VALUES (?, ?, ?, ?)",
    [emailHash(email), ip, succeeded ? 1 : 0, toSqlDateTime(now)],
    db,
  );

  if (!succeeded || !user) {
    await writeAudit(db, {
      organizationId: null,
      actorUserId: user?.id ?? null,
      action: "auth.login_failed",
      entityType: "user",
      entityId: user?.id ?? null,
      ipAddress: ip,
    });
    return { ok: false, reason: "invalid_credentials" };
  }

  // Transparently upgrade hashes created with weaker parameters.
  if (needsRehash(user.password_hash)) {
    await execute("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(password), user.id], db);
  }
  await execute("UPDATE users SET last_login_at = ? WHERE id = ?", [toSqlDateTime(now), user.id], db);
  await writeAudit(db, {
    organizationId: null,
    actorUserId: user.id,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    ipAddress: ip,
  });

  return { ok: true, userId: user.id, mustChangePassword: user.must_change_password === 1 };
}
