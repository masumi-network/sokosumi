"use client";

import type { PaidSubscriptionPlanName } from "@sokosumi/utils";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { clearSubscriptionOnboardingGateSessionCookie } from "@/lib/actions/onboarding";
import {
  validateOrganizationSubscriptionChange,
  validatePersonalSubscriptionChange,
} from "@/lib/actions/subscription";
import { subscription } from "@/lib/auth/auth.client";
import { buildSubscriptionStatusPath } from "@/lib/stripe/subscription-redirect-urls";
import { Err, Ok, type Result } from "@/lib/ts-res";

export type SubscriptionChangeResult =
  | { mode: "complete" }
  | { mode: "redirect"; url: string };

interface BetterAuthClientError {
  code?: string;
  message?: string;
  status?: number;
}

function mapAuthClientError(error: BetterAuthClientError): ActionError {
  if (error.code) {
    return {
      code: error.code,
      ...(error.message ? { message: error.message } : {}),
    };
  }

  if (error.status === 401 || error.status === 403) {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      ...(error.message ? { message: error.message } : {}),
    };
  }

  if (error.status === 400) {
    return {
      code: CommonErrorCode.BAD_INPUT,
      ...(error.message ? { message: error.message } : {}),
    };
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    ...(error.message ? { message: error.message } : {}),
  };
}

function resolveUpgradeResult(
  data: { url?: string | null } | null | undefined,
): Result<SubscriptionChangeResult, ActionError> {
  if (!data?.url) {
    return Ok({ mode: "complete" });
  }

  return Ok({ mode: "redirect", url: data.url });
}

export async function upgradePersonalSubscriptionClient({
  plan,
  returnPath,
}: {
  plan: PaidSubscriptionPlanName;
  returnPath?: string;
}): Promise<Result<SubscriptionChangeResult, ActionError>> {
  const validation = await validatePersonalSubscriptionChange({
    plan,
    returnPath,
  });
  if (!validation.ok) {
    return validation;
  }

  const resolvedReturnPath = returnPath ?? "/billing?tab=subscription";

  const result = await subscription.upgrade({
    plan,
    customerType: "user",
    successUrl: buildSubscriptionStatusPath(resolvedReturnPath, "success"),
    cancelUrl: buildSubscriptionStatusPath(resolvedReturnPath, "cancel"),
    returnUrl: resolvedReturnPath,
    disableRedirect: true,
  });

  if (result.error) {
    return Err(mapAuthClientError(result.error));
  }

  // Clear the onboarding gate only after the checkout call succeeds — clearing
  // it before would permanently suppress the gate if the upgrade call failed.
  await clearSubscriptionOnboardingGateSessionCookie();

  return resolveUpgradeResult(result.data);
}

export async function openPersonalBillingPortalClient({
  returnPath,
}: {
  returnPath?: string;
}): Promise<Result<{ url: string }, ActionError>> {
  const validation = await validatePersonalSubscriptionChange({ returnPath });
  if (!validation.ok) {
    return validation;
  }

  const resolvedReturnPath = returnPath ?? "/billing?tab=subscription";

  const result = await subscription.billingPortal({
    customerType: "user",
    returnUrl: resolvedReturnPath,
    disableRedirect: true,
  });

  if (result.error) {
    return Err(mapAuthClientError(result.error));
  }

  if (!result.data?.url) {
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }

  return Ok({ url: result.data.url });
}

export async function upgradeOrganizationSubscriptionClient({
  organizationId,
  plan,
  returnPath,
  seats,
}: {
  organizationId: string;
  plan: PaidSubscriptionPlanName;
  returnPath: string;
  seats: number;
}): Promise<Result<SubscriptionChangeResult, ActionError>> {
  const validation = await validateOrganizationSubscriptionChange({
    organizationId,
    plan,
    returnPath,
    seats,
  });
  if (!validation.ok) {
    return validation;
  }

  const result = await subscription.upgrade({
    plan,
    customerType: "organization",
    referenceId: organizationId,
    seats,
    successUrl: buildSubscriptionStatusPath(returnPath, "success"),
    cancelUrl: buildSubscriptionStatusPath(returnPath, "cancel"),
    returnUrl: returnPath,
    disableRedirect: true,
  });

  if (result.error) {
    return Err(mapAuthClientError(result.error));
  }

  // Clear the onboarding gate only after the checkout call succeeds — clearing
  // it before would permanently suppress the gate if the upgrade call failed.
  await clearSubscriptionOnboardingGateSessionCookie();

  return resolveUpgradeResult(result.data);
}

export async function openOrganizationBillingPortalClient({
  organizationId,
  returnPath,
}: {
  organizationId: string;
  returnPath: string;
}): Promise<Result<{ url: string }, ActionError>> {
  const validation = await validateOrganizationSubscriptionChange({
    organizationId,
    returnPath,
  });
  if (!validation.ok) {
    return validation;
  }

  const result = await subscription.billingPortal({
    customerType: "organization",
    referenceId: organizationId,
    returnUrl: returnPath,
    disableRedirect: true,
  });

  if (result.error) {
    return Err(mapAuthClientError(result.error));
  }

  if (!result.data?.url) {
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }

  return Ok({ url: result.data.url });
}
