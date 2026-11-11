/**
 * Validates a post-login redirect target to prevent open redirects.
 * Only same-origin, absolute paths are accepted (e.g. "/ecommerce?x=1").
 */
export const DEFAULT_AUTHENTICATED_PATH = "/dashboard";

export function safeRedirectPath(target: unknown, fallback = DEFAULT_AUTHENTICATED_PATH): string {
  if (typeof target !== "string") return fallback;
  const value = target.trim();
  if (value === "" || value.length > 512) return fallback;
  // Must be a path, not protocol-relative ("//evil.com") or backslash tricks ("/\evil.com").
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Reject control characters and any embedded scheme.
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const parsed = new URL(value, "http://internal.invalid");
    if (parsed.origin !== "http://internal.invalid") return fallback;
    // Never bounce back into auth pages.
    if (parsed.pathname === "/login" || parsed.pathname.startsWith("/auth/")) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
