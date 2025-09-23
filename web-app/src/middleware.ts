import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";

const EXCLUDED_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/accept-invitation",
  "/share/jobs",
  "/health",
  "/api-docs",
  "/robots.txt",
  "/sitemap.xml",
  "/openapi.json",
  "/manifest.json",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/apple-touch-icon",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isApiV1Path = pathname.startsWith("/api/v1");

  // Handle CORS for public API v1 endpoints
  if (isApiV1Path) {
    const corsHeaders = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Requested-With, x-api-key",
      "Access-Control-Max-Age": "86400",
    });

    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: corsHeaders });
    }

    const response = NextResponse.next();
    corsHeaders.forEach((value, key) => {
      response.headers.set(key, value);
    });

    return response;
  }

  // Skip middleware for excluded paths
  if (EXCLUDED_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Add current URL to headers for server components
  const searchParams = request.nextUrl.search;
  const response = NextResponse.next();
  response.headers.set("x-pathname", pathname);
  response.headers.set("x-search-params", searchParams);

  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const currentUrl = pathname + searchParams;
    const returnUrl = encodeURIComponent(currentUrl);
    return NextResponse.redirect(
      new URL(`/login?returnUrl=${returnUrl}`, request.url),
    );
  }

  // Check if user needs onboarding (this will be checked server-side in the onboarding page)
  // The actual onboarding status check happens in the page component

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
     * - legal directory in /public (public static legal documents)
     * - js directory in /public (public static js files)
     */
    "/((?!api|_next/static|_next/image|images|public|legal|js).*)",
    "/api/v1/:path*",
  ],
};
