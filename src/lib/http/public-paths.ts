/** Routes reachable without a session cookie. Everything else requires sign-in. */
const PUBLIC_PATHS = ["/login", "/api/health"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
