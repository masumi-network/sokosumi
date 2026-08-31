import { resolveBetterAuthCookiePrefix } from "@sokosumi/utils";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { applyDocumentSecurityHeaders } from "@/config/document-security-headers";
import { getEnvSecrets } from "@/config/env.secrets";
import {
  applyPendingOrganizationJoinCookie,
  joinTokenFromJoinPath,
} from "@/lib/pending-organization-join-cookie";
import { RETIRED_SUBSCRIPTION_ONBOARDING_GATE_COOKIE_NAME } from "@/lib/retired-onboarding-storage";

const EXCLUDED_PATHS = [
  "/auth/",
  "/signin",
  "/login",
  "/signup",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/accept-invitation",
  "/join/",
  "/share/",
  "/health",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.json",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/apple-touch-icon",
  // The push service worker. The browser re-fetches it to check for updates,
  // and a redirect fails a worker script fetch, so a reader whose session
  // cookie expired would keep the worker version they installed.
  //
  // Spelled out rather than imported as `NOTIFICATION_SERVICE_WORKER_URL`: that
  // constant sits in a module that imports zod and the notification schema, and
  // the proxy runs on every request. `proxy.test.ts` builds the URL from the
  // constant, so a rename fails there rather than silently here.
  "/ably-push-sw.js",
  "/maintenance",
];

function expireRetiredOnboardingGateCookie(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  if (request.cookies.has(RETIRED_SUBSCRIPTION_ONBOARDING_GATE_COOKIE_NAME)) {
    response.cookies.set({
      name: RETIRED_SUBSCRIPTION_ONBOARDING_GATE_COOKIE_NAME,
      value: "",
      path: "/",
      maxAge: 0,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }
  return response;
}

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
      return expireRetiredOnboardingGateCookie(
        request,
        NextResponse.json(
          { error: "Service is under maintenance" },
          { status: 503 },
        ),
      );
    }
    if (pathname !== "/maintenance") {
      return expireRetiredOnboardingGateCookie(
        request,
        NextResponse.redirect(new URL("/maintenance", request.url)),
      );
    }
  }

  // Unauthenticated `/` → sign-in with returnUrl (same as other protected
  // routes) so Welcome queries (e.g. `/?notice=…`) survive login.
  // Authenticated `/` is Welcome — fall through to Next (do not redirect;
  // landing path is `/` and would loop forever).
  if (pathname === "/") {
    const sessionCookie = getSessionCookie(request, {
      cookiePrefix: betterAuthCookiePrefix,
    });
    if (!sessionCookie) {
      const currentUrl = pathname + searchParams;
      const returnUrl = encodeURIComponent(currentUrl);
      const redirectResponse = NextResponse.redirect(
        new URL(`/signin?returnUrl=${returnUrl}`, request.url),
      );
      applyDocumentSecurityHeaders(redirectResponse);
      return expireRetiredOnboardingGateCookie(request, redirectResponse);
    }
  }

  // Create response early so we can always set pathname + document headers
  const response = NextResponse.next();
  response.headers.set("x-pathname", pathname);
  response.headers.set("x-search-params", searchParams);
  applyDocumentSecurityHeaders(response);

  // Persist `/join/:token` on the response (not an RSC cookies().set).
  const joinToken = joinTokenFromJoinPath(pathname);
  if (joinToken) {
    applyPendingOrganizationJoinCookie(
      response.cookies,
      joinToken,
      request.nextUrl.protocol === "https:",
    );
  }

  // Skip session check for excluded paths (but still set headers above)
  if (EXCLUDED_PATHS.some((path) => pathname.startsWith(path))) {
    return expireRetiredOnboardingGateCookie(request, response);
  }

  // Check session for protected routes
  const sessionCookie = getSessionCookie(request, {
    cookiePrefix: betterAuthCookiePrefix,
  });
  if (!sessionCookie) {
    const currentUrl = pathname + searchParams;
    const returnUrl = encodeURIComponent(currentUrl);
    return expireRetiredOnboardingGateCookie(
      request,
      NextResponse.redirect(
        new URL(`/signin?returnUrl=${returnUrl}`, request.url),
      ),
    );
  }

  // Workspace gate (not ready → /setup) is enforced server-side in
  // AuthenticatedAppFrame via Core workspace access.

  return expireRetiredOnboardingGateCookie(request, response);
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
