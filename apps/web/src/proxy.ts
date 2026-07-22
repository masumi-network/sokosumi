import { resolveBetterAuthCookiePrefix } from "@sokosumi/utils";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { applyDocumentSecurityHeaders } from "@/config/document-security-headers";
import { getEnvSecrets } from "@/config/env.secrets";
import { DEFAULT_AUTHENTICATED_LANDING_PATH } from "@/lib/utils/landing-path";

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

  // `/` is only an entry hop: resolve destination at the edge so we never run
  // root + (app) RSC (metadata, messages, layout) before the first redirect.
  if (pathname === "/") {
    const sessionCookie = getSessionCookie(request, {
      cookiePrefix: betterAuthCookiePrefix,
    });
    const destination = sessionCookie
      ? DEFAULT_AUTHENTICATED_LANDING_PATH
      : "/signin";
    const redirectResponse = NextResponse.redirect(
      new URL(destination, request.url),
    );
    applyDocumentSecurityHeaders(redirectResponse);
    return redirectResponse;
  }

  // Create response early so we can always set pathname + document headers
  const response = NextResponse.next();
  response.headers.set("x-pathname", pathname);
  response.headers.set("x-search-params", searchParams);
  applyDocumentSecurityHeaders(response);

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
