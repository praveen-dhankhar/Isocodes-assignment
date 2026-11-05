import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Sends signed-out visitors to /login. A cookie check only, not trusted: every Server Action and Route Handler
 * authenticates for itself (ARCHITECTURE §9).
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Pages only: API routes answer 401 themselves; /login and static assets stay public.
  matcher: ["/((?!api|login|_next/static|_next/image|favicon.ico).*)"],
};
