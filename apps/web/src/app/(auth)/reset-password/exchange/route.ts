import { type NextRequest, NextResponse } from "next/server";

import {
  buildAuthPageUrl,
  buildRequestNewResetLinkUrl,
  readAuthPageContext,
} from "@/lib/auth/auth.utils";
import { RESET_PASSWORD_TOKEN_COOKIE_NAME } from "@/lib/reset-password-token";
import { applyResetPasswordTokenCookie } from "@/lib/reset-password-token-cookie";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = new URLSearchParams(request.nextUrl.searchParams);
  const token = searchParams.get("token");
  // The emailed link carries the sign-in it started from, beside the token.
  searchParams.delete("token");
  searchParams.delete("error");
  const context = readAuthPageContext(searchParams);

  // A dead link gets a fresh one requested, not a silent sign-in page.
  const requestNewLink = () =>
    NextResponse.redirect(
      new URL(buildRequestNewResetLinkUrl(context), request.url),
    );

  if (!token) {
    return requestNewLink();
  }

  const response = NextResponse.redirect(
    new URL(buildAuthPageUrl("/reset-password", context), request.url),
  );
  applyResetPasswordTokenCookie(
    response.cookies,
    token,
    request.nextUrl.protocol === "https:",
  );

  if (!response.cookies.has(RESET_PASSWORD_TOKEN_COOKIE_NAME)) {
    return requestNewLink();
  }

  return response;
}
