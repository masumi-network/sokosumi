import "server-only";

import type { PaidSubscriptionPlanName } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { headers } from "next/headers";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { OrganizationErrorCode } from "@/lib/actions/errors/error-codes";
import { clearSubscriptionOnboardingGateSessionCookie } from "@/lib/actions/onboarding";
import {
  getAuthServerClient,
  resolveWebRequestOrigin,
} from "@/lib/auth/auth.server.client";
import { getAbsoluteRedirectUrlForOrigin } from "@/lib/auth/auth.utils";
import { buildSubscriptionStatusPath } from "@/lib/stripe/subscription-redirect-urls";

export type SubscriptionChangeResult =
  | { mode: "complete" }
  | { mode: "redirect"; url: string };

// A known-safe internal landing page used when the caller's returnPath is
// rejected by the origin sanitizer. Passing returnPath as its own fallback
// would re-admit an off-origin value, so anchor to a constant instead.
const SAFE_REDIRECT_FALLBACK = "/billing?tab=subscription";

interface BetterAuthClientError {
  code?: string;
  message?: string;
  status?: number;
}

function mapAuthClientError(error: BetterAuthClientError): ActionError {
  console.error("[subscription] auth client error", error);

  if (
    error.code ===
    OrganizationErrorCode.ORGANIZATION_ENTERPRISE_CONTRACT_EXCLUSIVE
  ) {
    return { code: error.code };
  }

  switch (error.status) {
    case 401:
      return { code: CommonErrorCode.UNAUTHENTICATED };
    case 403:
      return { code: CommonErrorCode.UNAUTHORIZED };
    case 400:
      return { code: CommonErrorCode.BAD_INPUT };
    default:
      return { code: CommonErrorCode.INTERNAL_SERVER_ERROR };
  }
}

function resolveUpgradeResult(
  data: { url?: string | null } | null | undefined,
): ActionResultDto<SubscriptionChangeResult, ActionError> {
  if (!data?.url) {
    return toActionResult(ok({ mode: "complete" }));
  }

  return toActionResult(ok({ mode: "redirect", url: data.url }));
}

async function resolveSubscriptionRedirectUrls(returnPath: string): Promise<
  ActionResultDto<
    {
      cancelUrl: string;
      returnUrl: string;
      successUrl: string;
    },
    ActionError
  >
> {
  const requestHeaders = await headers();
  const origin = resolveWebRequestOrigin(requestHeaders);

  if (!origin) {
    return toActionResult(
      err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      }),
    );
  }

  return toActionResult(
    ok({
      cancelUrl: getAbsoluteRedirectUrlForOrigin(
        origin,
        buildSubscriptionStatusPath(returnPath, "cancel"),
        SAFE_REDIRECT_FALLBACK,
      ),
      returnUrl: getAbsoluteRedirectUrlForOrigin(
        origin,
        returnPath,
        SAFE_REDIRECT_FALLBACK,
      ),
      successUrl: getAbsoluteRedirectUrlForOrigin(
        origin,
        buildSubscriptionStatusPath(returnPath, "success"),
        SAFE_REDIRECT_FALLBACK,
      ),
    }),
  );
}

export async function upgradePersonalSubscriptionServer({
  plan,
  returnPath,
}: {
  plan: PaidSubscriptionPlanName;
  returnPath?: string;
}): Promise<ActionResultDto<SubscriptionChangeResult, ActionError>> {
  const resolvedReturnPath = returnPath ?? "/billing?tab=subscription";
  const redirectUrlsResult =
    await resolveSubscriptionRedirectUrls(resolvedReturnPath);

  if (!redirectUrlsResult.ok) {
    return toActionResult(err(redirectUrlsResult.error));
  }

  const redirectUrls = redirectUrlsResult.value;

  const result = await getAuthServerClient().subscription.upgrade({
    plan,
    customerType: "user",
    successUrl: redirectUrls.successUrl,
    cancelUrl: redirectUrls.cancelUrl,
    returnUrl: redirectUrls.returnUrl,
    disableRedirect: true,
  });

  if (result.error) {
    return toActionResult(err(mapAuthClientError(result.error)));
  }

  await clearSubscriptionOnboardingGateSessionCookie();

  return resolveUpgradeResult(result.data);
}

export async function openPersonalBillingPortalServer({
  returnPath,
}: {
  returnPath?: string;
}): Promise<ActionResultDto<{ url: string }, ActionError>> {
  const resolvedReturnPath = returnPath ?? "/billing?tab=subscription";
  const redirectUrlsResult =
    await resolveSubscriptionRedirectUrls(resolvedReturnPath);

  if (!redirectUrlsResult.ok) {
    return toActionResult(err(redirectUrlsResult.error));
  }

  const result = await getAuthServerClient().subscription.billingPortal({
    customerType: "user",
    returnUrl: redirectUrlsResult.value.returnUrl,
    disableRedirect: true,
  });

  if (result.error) {
    return toActionResult(err(mapAuthClientError(result.error)));
  }

  if (!result.data?.url) {
    return toActionResult(
      err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      }),
    );
  }

  return toActionResult(ok({ url: result.data.url }));
}

export async function upgradeOrganizationSubscriptionServer({
  organizationId,
  plan,
  returnPath,
  seats,
}: {
  organizationId: string;
  plan: PaidSubscriptionPlanName;
  returnPath: string;
  seats: number;
}): Promise<ActionResultDto<SubscriptionChangeResult, ActionError>> {
  const redirectUrlsResult = await resolveSubscriptionRedirectUrls(returnPath);

  if (!redirectUrlsResult.ok) {
    return toActionResult(err(redirectUrlsResult.error));
  }

  const redirectUrls = redirectUrlsResult.value;

  const result = await getAuthServerClient().subscription.upgrade({
    plan,
    customerType: "organization",
    referenceId: organizationId,
    seats,
    successUrl: redirectUrls.successUrl,
    cancelUrl: redirectUrls.cancelUrl,
    returnUrl: redirectUrls.returnUrl,
    disableRedirect: true,
  });

  if (result.error) {
    return toActionResult(err(mapAuthClientError(result.error)));
  }

  await clearSubscriptionOnboardingGateSessionCookie();

  return resolveUpgradeResult(result.data);
}

export async function openOrganizationBillingPortalServer({
  organizationId,
  returnPath,
}: {
  organizationId: string;
  returnPath: string;
}): Promise<ActionResultDto<{ url: string }, ActionError>> {
  const redirectUrlsResult = await resolveSubscriptionRedirectUrls(returnPath);

  if (!redirectUrlsResult.ok) {
    return toActionResult(err(redirectUrlsResult.error));
  }

  const result = await getAuthServerClient().subscription.billingPortal({
    customerType: "organization",
    referenceId: organizationId,
    returnUrl: redirectUrlsResult.value.returnUrl,
    disableRedirect: true,
  });

  if (result.error) {
    return toActionResult(err(mapAuthClientError(result.error)));
  }

  if (!result.data?.url) {
    return toActionResult(
      err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      }),
    );
  }

  return toActionResult(ok({ url: result.data.url }));
}
