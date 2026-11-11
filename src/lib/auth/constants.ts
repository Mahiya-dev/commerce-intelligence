/** Shared, dependency-free auth constants (safe to import from proxy.ts). */

/** `__Host-` prefix requires Secure + Path=/ and no Domain: prevents subdomain cookie injection. */
export const SESSION_COOKIE_SECURE = "__Host-uci_session";
/** Plain-HTTP local development cannot use the __Host- prefix. */
export const SESSION_COOKIE_INSECURE = "uci_session";

export function sessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_INSECURE;
}

export const SESSION_POLICY = {
  /** Sign out after this much inactivity. */
  idleMinutes: 8 * 60,
  /** Hard limit regardless of activity. */
  absoluteDays: 7,
  /** Persist last_seen/idle expiry at most this often (limits DB writes). */
  touchIntervalMinutes: 5,
} as const;

export const LOGIN_THROTTLE = {
  windowMinutes: 15,
  /** Failed attempts per email within the window before temporary lockout. */
  maxFailuresPerEmail: 5,
  /** Failed attempts per IP within the window (credential stuffing). */
  maxFailuresPerIp: 30,
} as const;
