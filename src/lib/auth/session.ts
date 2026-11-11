import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { isDatabaseConfigured, isSecureOrigin } from "@/lib/env";
import { sessionCookieName } from "@/lib/auth/constants";
import { resolveSession, type SessionState } from "@/lib/auth/sessions";

export type { ActiveSession, SessionState, SessionUser, SessionOrganization } from "@/lib/auth/sessions";

function cookieName(): string {
  return sessionCookieName(isSecureOrigin());
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(cookieName())?.value;
}

/**
 * Data Access Layer entry point: resolves the session cookie against the
 * sessions table (once per request thanks to React cache()).
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const token = await readSessionToken();
  // Session validity depends on the current time (idle/absolute expiry), so it
  // must be evaluated at request time — never during (runtime) prerendering.
  await connection();
  // Without a database there can be no valid session; send users to /login,
  // which explains the missing configuration.
  if (!isDatabaseConfigured()) return { status: "unauthenticated" };
  return resolveSession(token);
});

/** Only callable from Server Actions / Route Handlers (cookies are writable there). */
export async function setSessionCookie(token: string, expires: Date): Promise<void> {
  (await cookies()).set(cookieName(), token, {
    httpOnly: true,
    secure: isSecureOrigin(),
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(cookieName());
}

/** Best-effort client IP (cPanel/Apache sets X-Forwarded-For / X-Real-IP). */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip")?.trim() || null;
  return ip && ip.length <= 45 ? ip : null;
}

export async function getUserAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}
