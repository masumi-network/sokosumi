import { getSessionCookie } from "better-auth/cookies";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AppRoute, LandingRoute } from "@/types/routes";

export async function authorizationMiddleware(
  req: NextRequest,
  restrictedPaths: string[] = [AppRoute.Home],
) {
  if (restrictedPaths.some((path) => req.nextUrl.pathname.startsWith(path))) {
    const sessionCookie = getSessionCookie(req);

    // Check if the session cookie is present
    if (!sessionCookie) {
      // Redirect to login page if not authenticated
      return NextResponse.redirect(new URL(LandingRoute.SignIn, req.url));
    }
  }
  // Allow the request to proceed if authenticated
  return NextResponse.next();
}
