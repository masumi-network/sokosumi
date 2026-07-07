import { type NextRequest, NextResponse } from "next/server";

import { CommonErrorCode } from "@/lib/actions/errors";
import { getSession } from "@/lib/auth/auth.server";
import { sanitizeAuthRedirectPathForOrigin } from "@/lib/auth/auth.utils";
import {
  openOrganizationBillingPortalServer,
  openPersonalBillingPortalServer,
} from "@/lib/auth/subscription.server";

export const dynamic = "force-dynamic";

const SAFE_RETURN_FALLBACK = "/billing?tab=subscription";

function redirectToSignIn(
  request: NextRequest,
  returnPath: string,
): NextResponse {
  const origin = request.nextUrl.origin;
  const signInUrl = new URL("/signin", origin);
  signInUrl.searchParams.set(
    "returnUrl",
    sanitizeAuthRedirectPathForOrigin(returnPath, origin, SAFE_RETURN_FALLBACK),
  );

  return NextResponse.redirect(signInUrl);
}

function redirectToReturnPath(
  request: NextRequest,
  returnPath: string,
): NextResponse {
  const origin = request.nextUrl.origin;
  const safePath = sanitizeAuthRedirectPathForOrigin(
    returnPath,
    origin,
    SAFE_RETURN_FALLBACK,
  );

  return NextResponse.redirect(new URL(safePath, origin));
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const organizationId = searchParams.get("organizationId")?.trim() || null;
  const origin = request.nextUrl.origin;
  const safeReturnPath = sanitizeAuthRedirectPathForOrigin(
    searchParams.get("returnPath") ?? undefined,
    origin,
    SAFE_RETURN_FALLBACK,
  );

  const session = await getSession();
  if (!session) {
    return redirectToSignIn(request, safeReturnPath);
  }

  const result = organizationId
    ? await openOrganizationBillingPortalServer({
        organizationId,
        returnPath: safeReturnPath,
      })
    : await openPersonalBillingPortalServer({
        returnPath: safeReturnPath,
      });

  if (!result.ok) {
    if (result.error.code === CommonErrorCode.UNAUTHENTICATED) {
      return redirectToSignIn(request, safeReturnPath);
    }

    return redirectToReturnPath(request, safeReturnPath);
  }

  return NextResponse.redirect(result.data.url);
}
