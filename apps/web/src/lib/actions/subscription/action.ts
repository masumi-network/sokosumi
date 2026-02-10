"use server";

import { headers } from "next/headers";
import * as z from "zod";

import {
  ActionError,
  betterAuthApiErrorSchema,
  CommonErrorCode,
} from "@/lib/actions/errors";
import { auth } from "@/lib/auth/auth";
import { organizationSubscriptionService } from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";
import {
  AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";

const subscriptionPlanSchema = z.enum(["free", "starter", "standard", "pro"]);

const upgradePersonalSubscriptionSchema = z.object({
  plan: subscriptionPlanSchema,
});

const upgradeOrganizationSubscriptionSchema = z.object({
  organizationId: z.string().min(1),
  plan: subscriptionPlanSchema,
  returnPath: z.string().startsWith("/"),
  seats: z.number().int().min(1),
});

const openOrganizationBillingPortalSchema = z.object({
  organizationId: z.string().min(1),
  returnPath: z.string().startsWith("/"),
});

const updateOrganizationSubscriptionSeatsSchema = z.object({
  organizationId: z.string().min(1),
  seats: z.number().int().min(1),
});

function parseBetterAuthActionError(error: unknown): ActionError {
  const parsedBetterAuthError = betterAuthApiErrorSchema.safeParse(error);
  if (parsedBetterAuthError.success) {
    return {
      code: parsedBetterAuthError.data.body.code,
      message: parsedBetterAuthError.data.body.message,
    };
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
  };
}

function getErrorStatus(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const errorWithStatus = error as Error & { status?: unknown };
  return typeof errorWithStatus.status === "string"
    ? errorWithStatus.status
    : null;
}

function parseOrganizationSeatUpdateError(error: unknown): ActionError {
  const status = getErrorStatus(error);
  if (status === "FORBIDDEN") {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      ...(error instanceof Error ? { message: error.message } : {}),
    };
  }

  if (status === "BAD_REQUEST") {
    return {
      code: CommonErrorCode.BAD_INPUT,
      ...(error instanceof Error ? { message: error.message } : {}),
    };
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    ...(error instanceof Error ? { message: error.message } : {}),
  };
}

interface UpgradePersonalSubscriptionParameters extends AuthenticatedRequest {
  plan: "free" | "starter" | "standard" | "pro";
}

export const upgradePersonalSubscription = withAuthContext<
  UpgradePersonalSubscriptionParameters,
  Result<{ url: string }, ActionError>
>(async ({ plan }) => {
  const parsed = upgradePersonalSubscriptionSchema.safeParse({
    plan,
  });
  if (!parsed.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
    });
  }

  try {
    const result = await auth.api.upgradeSubscription({
      headers: await headers(),
      body: {
        plan: parsed.data.plan,
        customerType: "user",
        successUrl: "/subscriptions?status=success",
        cancelUrl: "/subscriptions?status=cancel",
        returnUrl: "/subscriptions",
        disableRedirect: true,
      },
    });

    if (!result.url) {
      return Err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      });
    }

    return Ok({ url: result.url });
  } catch (error) {
    return Err(parseBetterAuthActionError(error));
  }
});

export const openPersonalBillingPortal = withAuthContext<
  AuthenticatedRequest,
  Result<{ url: string }, ActionError>
>(async () => {
  try {
    const result = await auth.api.createBillingPortal({
      headers: await headers(),
      body: {
        customerType: "user",
        returnUrl: "/subscriptions",
        disableRedirect: true,
      },
    });

    if (!result.url) {
      return Err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      });
    }

    return Ok({ url: result.url });
  } catch (error) {
    return Err(parseBetterAuthActionError(error));
  }
});

interface UpgradeOrganizationSubscriptionParameters extends AuthenticatedRequest {
  organizationId: string;
  plan: "free" | "starter" | "standard" | "pro";
  returnPath: string;
  seats: number;
}

export const upgradeOrganizationSubscription = withAuthContext<
  UpgradeOrganizationSubscriptionParameters,
  Result<{ url: string }, ActionError>
>(async ({ organizationId, plan, returnPath, seats }) => {
  const parsed = upgradeOrganizationSubscriptionSchema.safeParse({
    organizationId,
    plan,
    returnPath,
    seats,
  });
  if (!parsed.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
    });
  }

  try {
    const result = await auth.api.upgradeSubscription({
      headers: await headers(),
      body: {
        plan: parsed.data.plan,
        customerType: "organization",
        referenceId: parsed.data.organizationId,
        seats: parsed.data.seats,
        successUrl: parsed.data.returnPath,
        cancelUrl: parsed.data.returnPath,
        returnUrl: parsed.data.returnPath,
        disableRedirect: true,
      },
    });

    if (!result.url) {
      return Err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      });
    }

    return Ok({ url: result.url });
  } catch (error) {
    return Err(parseBetterAuthActionError(error));
  }
});

interface OpenOrganizationBillingPortalParameters extends AuthenticatedRequest {
  organizationId: string;
  returnPath: string;
}

export const openOrganizationBillingPortal = withAuthContext<
  OpenOrganizationBillingPortalParameters,
  Result<{ url: string }, ActionError>
>(async ({ organizationId, returnPath }) => {
  const parsed = openOrganizationBillingPortalSchema.safeParse({
    organizationId,
    returnPath,
  });
  if (!parsed.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
    });
  }

  try {
    const result = await auth.api.createBillingPortal({
      headers: await headers(),
      body: {
        customerType: "organization",
        referenceId: parsed.data.organizationId,
        returnUrl: parsed.data.returnPath,
        disableRedirect: true,
      },
    });

    if (!result.url) {
      return Err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      });
    }

    return Ok({ url: result.url });
  } catch (error) {
    return Err(parseBetterAuthActionError(error));
  }
});

interface UpdateOrganizationSubscriptionSeatsParameters
  extends AuthenticatedRequest {
  organizationId: string;
  seats: number;
}

export const updateOrganizationSubscriptionSeats = withAuthContext<
  UpdateOrganizationSubscriptionSeatsParameters,
  Result<{ seats: number }, ActionError>
>(async ({ authContext, organizationId, seats }) => {
  const parsed = updateOrganizationSubscriptionSeatsSchema.safeParse({
    organizationId,
    seats,
  });
  if (!parsed.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
    });
  }

  try {
    const result =
      await organizationSubscriptionService.updateOrganizationSeatsImmediately(
        authContext.userId,
        parsed.data.organizationId,
        parsed.data.seats,
      );

    return Ok(result);
  } catch (error) {
    return Err(parseOrganizationSeatUpdateError(error));
  }
});
