import { type NextRequest, NextResponse } from "next/server";

import { getAuth, renewSession } from "./lib/auth";

/**
 * Renews Sokosumi access before a page renders. When renewal changes the
 * cookies (a silent refresh, or a sign out after a failed one), the browser
 * reloads the page with them, so the page always renders the current state.
 */
export async function proxy(request: NextRequest) {
  const renewal = await renewSession(getAuth(), request);
  const headers = new Headers(renewal.headers);
  if (["/signup", "/signin"].includes(request.nextUrl.pathname)) {
    headers.set("cache-control", "no-store");
  }
  if (renewal.status === 503) {
    return new NextResponse("CMO is temporarily unavailable. Try again.", {
      status: 503,
      headers,
    });
  }
  const cookies = renewal.headers.getSetCookie();
  if (cookies.length === 0) return NextResponse.next();

  return NextResponse.redirect(request.nextUrl, { headers });
}

export const config = {
  matcher: [
    {
      source: "/((?!api/|_next/|favicon.ico).*)",
      // Server actions sign in and out themselves. Prefetch must not rotate
      // the refresh token. Next strips these headers before proxy() runs, so
      // only the matcher can see them.
      missing: [
        { type: "header", key: "next-action" },
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "next-router-segment-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
        { type: "header", key: "sec-purpose", value: "prefetch.*" },
      ],
    },
  ],
};
