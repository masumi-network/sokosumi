import { type NextRequest, NextResponse } from "next/server";

import { getAuth, renewSession } from "./lib/auth";

/**
 * Renews Sokosumi access before a page renders. When renewal changes the
 * cookies (a silent refresh, or a sign out after a failed one), the browser
 * reloads the page with them, so the page always renders the current state.
 */
export async function proxy(request: NextRequest) {
  const auth = getAuth();
  // A preview's sign in returns to its branch alias, so a flow started on
  // the deployment URL would lose its state cookie. Only on previews: there
  // Vercel passes the real host, while a local proxy shows Next its own.
  if (process.env.VERCEL_ENV === "preview") {
    const base = new URL(auth.options.baseURL);
    if (request.nextUrl.host !== base.host) {
      const target = new URL(
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
        base,
      );
      return NextResponse.redirect(target, 308);
    }
  }

  const renewal = await renewSession(auth, request);
  // Renewal redirects and outages belong to one visitor; never cache them.
  const headers = new Headers(renewal.headers);
  headers.set("cache-control", "no-store");
  if (renewal.status === 503) {
    return new NextResponse("CMO is temporarily unavailable. Try again.", {
      status: 503,
      headers,
    });
  }
  const cookies = renewal.headers.getSetCookie();
  if (cookies.length === 0) return NextResponse.next();

  const target = request.nextUrl.clone();
  // CMO ended the session (a ban, a revoked token, a failed refresh).
  if (renewal.status === 401) target.searchParams.set("error", "signed_out");
  return NextResponse.redirect(target, { headers });
}

export const config = {
  matcher: [
    {
      // Files in public/ (icons, logo, mascot) are static; skip renewal.
      source: "/((?!api/|_next/|.*\\.[a-z0-9]+$).*)",
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
