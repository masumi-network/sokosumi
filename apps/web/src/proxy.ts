import {
  resolveBetterAuthCookiePrefix,
  resolveBetterAuthRequestCookieDomain,
} from "@sokosumi/utils";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { applyDocumentSecurityHeaders } from "@/config/document-security-headers";
import { getEnvSecrets } from "@/config/env.secrets";

/**
 * TEMPORARY session-survival shim for the Better Auth web → core migration.
 *
 * Auth cookies must be visible to both origins:
 * - **Local dev**: web (:3000) and core (:8787) share `Domain=localhost`.
 * - **Deployed**: web (e.g. app.sokosumi.com) and core (e.g. core.sokosumi.com)
 *   share `BETTER_AUTH_COOKIE_DOMAIN`.
 *
 * Sign-in often leaves a host-only cookie on the web origin; browsers will not
 * send it to core's host. This re-sets the same value with the shared domain
 * core uses (`crossSubDomainCookies`), plus a marker cookie so we only do it
 * once per session.
 *
 * REMOVE after one full session max-age window (Better Auth default: 7 days)
 * has passed in production — by then every live session cookie has either
 * been re-scoped or expired.
 */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // Better Auth default session expiry
const MARKER_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const LEGACY_CROSS_PORT_MARKER_SUFFIX = "session_cross_port_scoped";

function hasSharedAuthCookieShimMarker(
  request: NextRequest,
  cookiePrefix: string,
): boolean {
  const markerName = `${cookiePrefix}.session_token_rescoped`;
  if (request.cookies.has(markerName)) {
    return true;
  }

  // Legacy marker from an earlier localhost-only shim — treat as done.
  return request.cookies.has(
    `${cookiePrefix}.${LEGACY_CROSS_PORT_MARKER_SUFFIX}`,
  );
}

function applySharedAuthSessionCookieShim(
  request: NextRequest,
  response: NextResponse,
  cookiePrefix: string,
  cookieDomain: string | undefined,
): void {
  if (!cookieDomain) {
    return;
  }

  if (hasSharedAuthCookieShimMarker(request, cookiePrefix)) {
    return;
  }

  const secureCookie = request.cookies.get(
    `__Secure-${cookiePrefix}.session_token`,
  );
  const sessionCookie =
    secureCookie ?? request.cookies.get(`${cookiePrefix}.session_token`);

  if (!sessionCookie?.value) {
    return;
  }

  const secure = Boolean(secureCookie);
  const markerName = `${cookiePrefix}.session_token_rescoped`;

  response.cookies.set(sessionCookie.name, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure,
  });
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
}

const EXCLUDED_PATHS = [
  "/auth/",
  "/signin",
  "/login",
  "/signup",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/accept-invitation",
  "/share/",
  "/health",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.json",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/apple-touch-icon",
  "/maintenance",
  // Composio OAuth redirects back to /composio/callback in a popup. The page
  // is purely client-side (URL params → postMessage → window.close) and the
  // popup may not carry the parent's session cookie, so it must not be
  // gated by the session check.
  "/composio/callback",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const searchParams = request.nextUrl.search;
  const env = getEnvSecrets();
  const betterAuthCookiePrefix = resolveBetterAuthCookiePrefix({
    network: env.NETWORK,
    vercelEnv: env.VERCEL_ENV,
    vercelGitCommitRef: env.VERCEL_GIT_COMMIT_REF,
  });

  // Check maintenance mode - redirect to /maintenance if enabled
  const isMaintenanceMode = env.MAINTENANCE_MODE;
  if (isMaintenanceMode) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json(
        { error: "Service is under maintenance" },
        { status: 503 },
      );
    }
    if (pathname !== "/maintenance") {
      return NextResponse.redirect(new URL("/maintenance", request.url));
    }
  }

  // Create response early so we can always set pathname + document headers
  const response = NextResponse.next();
  response.headers.set("x-pathname", pathname);
  response.headers.set("x-search-params", searchParams);
  applyDocumentSecurityHeaders(response);
  applySharedAuthSessionCookieShim(
    request,
    response,
    betterAuthCookiePrefix,
    resolveBetterAuthRequestCookieDomain({
      hostname: request.nextUrl.hostname,
      configuredDomain: env.BETTER_AUTH_COOKIE_DOMAIN,
    }),
  );

  // Skip session check for excluded paths (but still set headers above)
  if (EXCLUDED_PATHS.some((path) => pathname.startsWith(path))) {
    return response;
  }

  // Check session for protected routes
  const sessionCookie = getSessionCookie(request, {
    cookiePrefix: betterAuthCookiePrefix,
  });
  if (!sessionCookie) {
    const currentUrl = pathname + searchParams;
    const returnUrl = encodeURIComponent(currentUrl);
    return NextResponse.redirect(
      new URL(`/signin?returnUrl=${returnUrl}`, request.url),
    );
  }

  // Onboarding is checked server-side in the protected app layout.
  // Users who still need onboarding see the in-app onboarding dialog there.

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - images directory in /public (public static images)
     * - icons directory in /public (public static brand SVGs)
     * - legal directory in /public (public static legal documents)
     * - js directory in /public (public static js files)
     */
    "/((?!api|_next/static|_next/image|images|icons|public|legal|js).*)",
  ],
};
