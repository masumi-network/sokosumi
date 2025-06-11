import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Add current URL to headers for server components
  const pathname = request.nextUrl.pathname;
  const searchParams = request.nextUrl.search;

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

  return response;
}

export const config = {
  matcher: ["/app/:path*"], // Apply middleware to specific routes
};
