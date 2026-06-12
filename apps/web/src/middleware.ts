import { resolveBetterAuthCookiePrefix } from "@sokosumi/utils";
import { type NextRequest, NextResponse } from "next/server";

/**
 * TEMPORARY session-survival shim for the Better Auth web → core migration.
 *
 * Before the migration the session cookie was host-only on the web origin, so
 * browsers would not send it to core's host and every existing session would
 * be logged out at cutover. This middleware re-sets the same cookie value
 * scoped to the shared parent domain (BETTER_AUTH_COOKIE_DOMAIN) so core —
 * which signs with the same BETTER_AUTH_SECRET — accepts it. A companion
 * marker cookie prevents re-setting on every request.
 *
 * REMOVE after one full session max-age window (Better Auth default: 7 days)
 * has passed in production — by then every live session cookie has either
 * been re-scoped or expired.
 */

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // Better Auth default session expiry
const MARKER_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function getCookiePrefix(): string {
  const network = process.env.NETWORK === "Mainnet" ? "Mainnet" : "Preprod";
  return resolveBetterAuthCookiePrefix({
    network,
    vercelEnv: process.env.VERCEL_ENV,
    vercelGitCommitRef: process.env.VERCEL_GIT_COMMIT_REF,
  });
}

export function middleware(request: NextRequest): NextResponse {
  const cookieDomain = process.env.BETTER_AUTH_COOKIE_DOMAIN;
  if (!cookieDomain) {
    return NextResponse.next();
  }

  const prefix = getCookiePrefix();
  const markerName = `${prefix}.session_token_rescoped`;
  if (request.cookies.has(markerName)) {
    return NextResponse.next();
  }

  const secureSessionCookieName = `__Secure-${prefix}.session_token`;
  const sessionCookieName = `${prefix}.session_token`;
  const secureCookie = request.cookies.get(secureSessionCookieName);
  const plainCookie = secureCookie
    ? undefined
    : request.cookies.get(sessionCookieName);
  const sessionCookie = secureCookie ?? plainCookie;

  if (!sessionCookie?.value) {
    return NextResponse.next();
  }

  const secure = Boolean(secureCookie);
  const response = NextResponse.next();
  response.cookies.set(sessionCookie.name, sessionCookie.value, {
    domain: cookieDomain,
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure,
  });
  response.cookies.set(markerName, "1", {
    domain: cookieDomain,
    maxAge: MARKER_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure,
  });

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
