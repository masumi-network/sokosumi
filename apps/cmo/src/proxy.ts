import { type NextRequest, NextResponse } from "next/server";

import { getAuth, renewSession } from "./lib/auth";

/**
 * Renews Sokosumi access before a page renders. When renewal changes the
 * cookies (a silent refresh, or a sign out after a failed one), the browser
 * reloads the page with them, so the page always renders the current state.
 */
export async function proxy(request: NextRequest) {
  const renewal = await renewSession(getAuth(), request);
  const cookies = renewal.headers.getSetCookie();
  if (cookies.length === 0) return NextResponse.next();

  const response = NextResponse.redirect(request.nextUrl);
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api/|_next/|favicon.ico).*)",
      // Server actions sign in and out themselves.
      missing: [{ type: "header", key: "next-action" }],
    },
  ],
};
