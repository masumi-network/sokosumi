import { type NextRequest, NextResponse } from "next/server";

import { CommonErrorCode } from "@/lib/actions/errors";
import { getSession } from "@/lib/auth/auth.server";
import { sanitizeAuthRedirectPathForOrigin } from "@/lib/auth/auth.utils";
import {
  openOrganizationBillingPortalServer,
  openPersonalBillingPortalServer,
} from "@/lib/auth/subscription.server";
import {
  BILLING_PORTAL_ERROR_GENERAL,
  BILLING_PORTAL_ERROR_PARAM,
  BILLING_PORTAL_ERROR_UNAUTHORIZED,
  buildBillingPortalRedirectPath,
  isAllowedBillingPortalNavigation,
} from "@/lib/billing/billing-portal-redirect";
import { isAllowedStripeBillingPortalUrl } from "@/lib/billing/stripe-billing-portal-url";

const SAFE_RETURN_FALLBACK = "/billing?tab=subscription";

function redirectToSignIn(
  request: NextRequest,
  returnPath: string,
  organizationId: string | null,
): NextResponse {
  const origin = request.nextUrl.origin;
  const signInUrl = new URL("/signin", origin);
  // Return to the portal route (not the plain billing page) so the session is
  // created and the user lands on Stripe directly after authenticating.
  signInUrl.searchParams.set(
    "returnUrl",
    buildBillingPortalRedirectPath({ returnPath, organizationId }),
  );

  return NextResponse.redirect(signInUrl);
}

function redirectToReturnPathWithError(
  request: NextRequest,
  returnPath: string,
  errorCode: string = BILLING_PORTAL_ERROR_GENERAL,
): NextResponse {
  const origin = request.nextUrl.origin;
  const safePath = sanitizeAuthRedirectPathForOrigin(
    returnPath,
    origin,
    SAFE_RETURN_FALLBACK,
  );
  const url = new URL(safePath, origin);
  url.searchParams.set(BILLING_PORTAL_ERROR_PARAM, errorCode);

  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const hasOrganizationIdParam = searchParams.has("organizationId");
  const organizationId = searchParams.get("organizationId")?.trim() || null;
  const origin = request.nextUrl.origin;
  const safeReturnPath = sanitizeAuthRedirectPathForOrigin(
    searchParams.get("returnPath") ?? undefined,
    origin,
    SAFE_RETURN_FALLBACK,
  );

  if (
    !isAllowedBillingPortalNavigation(request.headers.get("Sec-Fetch-Site"))
  ) {
    return redirectToReturnPathWithError(request, safeReturnPath);
  }

  if (hasOrganizationIdParam && !organizationId) {
    return redirectToReturnPathWithError(request, safeReturnPath);
  }

  const session = await getSession();
  if (!session) {
    return redirectToSignIn(request, safeReturnPath, organizationId);
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
      return redirectToSignIn(request, safeReturnPath, organizationId);
    }

    if (result.error.code === CommonErrorCode.UNAUTHORIZED) {
      return redirectToReturnPathWithError(
        request,
        safeReturnPath,
        BILLING_PORTAL_ERROR_UNAUTHORIZED,
      );
    }

    return redirectToReturnPathWithError(request, safeReturnPath);
  }

  if (!isAllowedStripeBillingPortalUrl(result.data.url)) {
    console.error("[billing-portal] rejected redirect url", result.data.url);
    return redirectToReturnPathWithError(request, safeReturnPath);
  }

  return NextResponse.redirect(result.data.url);
}
