import { getSessionCookie } from "better-auth/cookies";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function authorizationMiddleware(req: NextRequest) {
  const sessionCookie = getSessionCookie(req);

  // Define the path you want to restrict
  const restrictedPath = "/dashboard";

  if (req.nextUrl.pathname.startsWith(restrictedPath)) {
    // Check if the session cookie is present
    if (!sessionCookie) {
      // Redirect to login page if not authenticated
      return NextResponse.redirect(new URL("/signin", req.url));
    }
  }
  // Allow the request to proceed if authenticated
  return NextResponse.next();
}
