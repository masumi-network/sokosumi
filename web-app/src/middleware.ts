import { NextRequest, NextResponse } from "next/server";

import { authorizationMiddleware } from "./middleware/authorization";

export async function middleware(req: NextRequest) {
  // Apply authorization middleware
  const authResponse = await authorizationMiddleware(req);
  authResponse.headers.append("x-current-path", req.nextUrl.pathname);
  if (authResponse) return authResponse;

  // If all middlewares pass, proceed with the request
  return NextResponse.next();
}

// Specify the paths where the middleware should run
export const config = {
  matcher: ["/app/:path*"],
};
