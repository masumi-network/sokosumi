import { type NextRequest, NextResponse } from "next/server";

import { RESET_PASSWORD_TOKEN_COOKIE_NAME } from "@/lib/reset-password-token";
import { applyResetPasswordTokenCookie } from "@/lib/reset-password-token-cookie";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  const response = NextResponse.redirect(
    new URL("/reset-password", request.url),
  );
  applyResetPasswordTokenCookie(
    response.cookies,
    token,
    request.nextUrl.protocol === "https:",
  );

  if (!response.cookies.has(RESET_PASSWORD_TOKEN_COOKIE_NAME)) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  return response;
}
