"use server";

import { headers } from "next/headers";
import * as z from "zod";

import {
  type ActionError,
  betterAuthApiErrorSchema,
  CommonErrorCode,
} from "@/lib/actions/errors";
import { auth } from "@/lib/auth/auth";
import { organizationSubscriptionService, stripeService } from "@/lib/services";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const subscriptionPlanSchema = z.enum(["free", "starter", "standard", "pro"]);
const personalReturnPathSchema = z.string().startsWith("/");

const upgradePersonalSubscriptionSchema = z.object({
  plan: subscriptionPlanSchema,
  returnPath: personalReturnPathSchema.optional(),
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
  const parsedBetterAuthError = betterAuthApiErrorSchema.safeParse(error);
  if (parsedBetterAuthError.success) {
    return {
      code: parsedBetterAuthError.data.body.code,
      message: parsedBetterAuthError.data.body.message,
    };
  }

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

type SubscriptionChangeResult =
  | {
      mode: "redirect";
      url: string;
    }
  | {
      mode: "scheduled";
    };

function buildSubscriptionStatusPath(
  returnPath: string,
  status: "cancel" | "success",
): string {
  const [pathname, queryString = ""] = returnPath.split("?");
  const searchParams = new URLSearchParams(queryString);
  searchParams.set("status", status);

  const nextQueryString = searchParams.toString();
  if (!nextQueryString) {
    return pathname;
  }

  return `${pathname}?${nextQueryString}`;
}

interface UpgradePersonalSubscriptionParameters extends AuthenticatedRequest {
  plan: "free" | "starter" | "standard" | "pro";
  returnPath?: string;
}

interface CancelPersonalSubscriptionParameters extends AuthenticatedRequest {}

export const cancelPersonalSubscription = withSession<
  CancelPersonalSubscriptionParameters,
  Result<{ mode: "scheduled" }, ActionError>
>(async ({ session }) => {
  try {
    await stripeService.scheduleSubscriptionDowngradeToFree(session.user.id);
    return Ok({ mode: "scheduled" });
  } catch (error) {
    return Err(parseOrganizationSeatUpdateError(error));
  }
});

export const upgradePersonalSubscription = withSession<
  UpgradePersonalSubscriptionParameters,
  Result<SubscriptionChangeResult, ActionError>
>(async ({ plan, returnPath, session }) => {
  const parsed = upgradePersonalSubscriptionSchema.safeParse({
    plan,
    returnPath,
  });
  if (!parsed.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
    });
  }

  try {
    const resolvedReturnPath =
      parsed.data.returnPath ?? "/billing?tab=subscription";

    if (parsed.data.plan === "free") {
      await stripeService.scheduleSubscriptionDowngradeToFree(session.user.id);
      return Ok({ mode: "scheduled" });
    }

    const result = await auth.api.upgradeSubscription({
      headers: await headers(),
      body: {
        plan: parsed.data.plan,
        customerType: "user",
        successUrl: buildSubscriptionStatusPath(resolvedReturnPath, "success"),
        cancelUrl: buildSubscriptionStatusPath(resolvedReturnPath, "cancel"),
        returnUrl: resolvedReturnPath,
        disableRedirect: true,
      },
    });

    if (!result.url) {
      return Err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      });
    }

    return Ok({ mode: "redirect", url: result.url });
  } catch (error) {
    return Err(parseOrganizationSeatUpdateError(error));
  }
});

interface OpenPersonalBillingPortalParameters extends AuthenticatedRequest {
  returnPath?: string;
}

export const openPersonalBillingPortal = withSession<
  OpenPersonalBillingPortalParameters,
  Result<{ url: string }, ActionError>
>(async ({ returnPath }) => {
  const parsedReturnPath = personalReturnPathSchema
    .optional()
    .safeParse(returnPath);
  if (!parsedReturnPath.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
    });
  }

  try {
    const result = await auth.api.createBillingPortal({
      headers: await headers(),
      body: {
        customerType: "user",
        returnUrl: parsedReturnPath.data ?? "/billing?tab=subscription",
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

interface UpgradeOrganizationSubscriptionParameters
  extends AuthenticatedRequest {
  organizationId: string;
  plan: "free" | "starter" | "standard" | "pro";
  returnPath: string;
  seats: number;
}

interface CancelOrganizationSubscriptionParameters
  extends AuthenticatedRequest {
  organizationId: string;
}

export const cancelOrganizationSubscription = withSession<
  CancelOrganizationSubscriptionParameters,
  Result<{ mode: "scheduled" }, ActionError>
>(async ({ organizationId, session }) => {
  const parsedOrganizationId = z.string().min(1).safeParse(organizationId);
  if (!parsedOrganizationId.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
    });
  }

  try {
    await organizationSubscriptionService.scheduleDowngradeToFree(
      session.user.id,
      parsedOrganizationId.data,
    );
    return Ok({ mode: "scheduled" });
  } catch (error) {
    return Err(parseOrganizationSeatUpdateError(error));
  }
});

export const upgradeOrganizationSubscription = withSession<
  UpgradeOrganizationSubscriptionParameters,
  Result<SubscriptionChangeResult, ActionError>
>(async ({ organizationId, plan, returnPath, seats, session }) => {
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
    if (parsed.data.plan === "free") {
      await organizationSubscriptionService.scheduleDowngradeToFree(
        session.user.id,
        parsed.data.organizationId,
      );
      return Ok({ mode: "scheduled" });
    }

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

    return Ok({ mode: "redirect", url: result.url });
  } catch (error) {
    return Err(parseOrganizationSeatUpdateError(error));
  }
});

interface OpenOrganizationBillingPortalParameters extends AuthenticatedRequest {
  organizationId: string;
  returnPath: string;
}

export const openOrganizationBillingPortal = withSession<
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

export const updateOrganizationSubscriptionSeats = withSession<
  UpdateOrganizationSubscriptionSeatsParameters,
  Result<{ seats: number }, ActionError>
>(async ({ session, organizationId, seats }) => {
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
        session.user.id,
        parsed.data.organizationId,
        parsed.data.seats,
      );

    return Ok(result);
  } catch (error) {
    return Err(parseOrganizationSeatUpdateError(error));
  }
});
