import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_INSECURE, SESSION_COOKIE_SECURE } from "@/lib/auth/constants";
import { isPublicPath } from "@/lib/http/public-paths";

/**
 * OPTIMISTIC check only: redirects requests without a session cookie to the
 * login page. The real check (session lookup in MySQL + role) happens
 * server-side in every page and action via requireSession()/requireRole().
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_SECURE) || request.cookies.has(SESSION_COOKIE_INSECURE);

  if (!hasSessionCookie && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
