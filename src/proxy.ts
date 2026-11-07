import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Two jobs, both cheap: a per-request CSP nonce for every page (ARCHITECTURE §9; Next.js reads it from the request
 * header and stamps its own inline scripts), and sending signed-out visitors to /login. The cookie check is not
 * trusted: every Server Action and Route Handler authenticates for itself.
 */
export function proxy(request: NextRequest) {
  const isLogin = request.nextUrl.pathname === "/login";
  if (!isLogin && !getSessionCookie(request)) return NextResponse.redirect(new URL("/login", request.url));

  const nonce = btoa(crypto.randomUUID());
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes (positions, widths, rotation) need this; no inline <style> or script comes from users.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(request.nextUrl.protocol === "https:" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Pages only: API routes answer 401 themselves and send no HTML; static assets (and the public demo video) need neither check.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|demo.webm).*)"],
};
