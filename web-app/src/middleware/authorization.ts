import { getSessionCookie } from "better-auth/cookies";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function authorizationMiddleware(
  req: NextRequest,
  restrictedPaths: string[] = ["/dashboard"],
) {
  const sessionCookie = getSessionCookie(req);

  if (restrictedPaths.some((path) => req.nextUrl.pathname.startsWith(path))) {
    // Check if the session cookie is present
    if (!sessionCookie) {
      // Redirect to login page if not authenticated
      return NextResponse.redirect(new URL("/signin", req.url));
    }
  }
  // Allow the request to proceed if authenticated
  return NextResponse.next();
}
