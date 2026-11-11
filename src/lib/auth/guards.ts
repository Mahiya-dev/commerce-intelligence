import "server-only";
import { redirect } from "next/navigation";
import { getSessionState, type ActiveSession } from "@/lib/auth/session";
import { hasRole, type AppRole } from "@/lib/auth/roles";

/** Server-side guard: signed in, password not pending change, member of an organization. */
export async function requireSession(): Promise<ActiveSession> {
  const session = await getSessionState();
  if (session.status === "unauthenticated") redirect("/login");
  if (session.user.mustChangePassword) redirect("/account/password");
  if (session.status === "no_access") redirect("/no-access");
  return session;
}

/** Server-side guard for role-restricted routes and server actions. */
export async function requireRole(minRole: AppRole): Promise<ActiveSession> {
  const session = await requireSession();
  if (!hasRole(session.role, minRole)) redirect("/forbidden");
  return session;
}
