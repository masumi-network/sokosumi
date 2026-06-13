"use server";

import {
  assertOrganizationSubscriptionChangeAllowed,
  OrganizationSubscriptionExclusivityError,
} from "@sokosumi/database/helpers";
import * as z from "zod";
import {
  type ActionError,
  betterAuthApiErrorSchema,
  CommonErrorCode,
} from "@/lib/actions/errors";
import prisma from "@/lib/db/prisma";
import { organizationSubscriptionService } from "@/lib/services";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const subscriptionPlanSchema = z.enum(["starter", "standard", "pro"]);
const personalReturnPathSchema = z.string().startsWith("/");

const validatePersonalSubscriptionChangeSchema = z.object({
  plan: subscriptionPlanSchema.optional(),
  returnPath: personalReturnPathSchema.optional(),
});

const validateOrganizationSubscriptionChangeSchema = z
  .object({
    organizationId: z.string().min(1),
    plan: subscriptionPlanSchema.optional(),
    returnPath: z.string().startsWith("/").optional(),
    seats: z.number().int().min(1).optional(),
  })
  .superRefine((data, context) => {
    if (data.plan !== undefined) {
      if (!data.returnPath) {
        context.addIssue({
          code: "custom",
          message: "returnPath is required for subscription checkout",
          path: ["returnPath"],
        });
      }

      if (data.seats === undefined) {
        context.addIssue({
          code: "custom",
          message: "seats is required for organization subscription checkout",
          path: ["seats"],
        });
      }

      return;
    }

    if (!data.returnPath) {
      context.addIssue({
        code: "custom",
        message: "returnPath is required",
        path: ["returnPath"],
      });
    }
  });

const updateOrganizationSubscriptionSeatsSchema = z.object({
  organizationId: z.string().min(1),
  seats: z.number().int().min(1),
});

function getErrorStatus(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const errorWithStatus = error as Error & { status?: unknown };
  return typeof errorWithStatus.status === "string"
    ? errorWithStatus.status
    : null;
}

function mapSubscriptionExclusivityError(error: unknown): ActionError | null {
  if (!(error instanceof OrganizationSubscriptionExclusivityError)) {
    return null;
  }

  return {
    code: CommonErrorCode.BAD_INPUT,
    message: error.message,
  };
}

function parseBetterAuthActionError(error: unknown): ActionError {
  const exclusivityError = mapSubscriptionExclusivityError(error);
  if (exclusivityError) {
    return exclusivityError;
  }

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

interface ValidatePersonalSubscriptionChangeParameters
  extends AuthenticatedRequest {
  plan?: "starter" | "standard" | "pro";
  returnPath?: string;
}

export const validatePersonalSubscriptionChange = withSession<
  ValidatePersonalSubscriptionChangeParameters,
  Result<void, ActionError>
>(async ({ plan, returnPath }) => {
  const parsed = validatePersonalSubscriptionChangeSchema.safeParse({
    plan,
    returnPath,
  });
  if (!parsed.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
    });
  }

  // Personal subscriptions are intentionally NOT gated by enterprise-contract
  // exclusivity: that restriction is scoped to the organization holding the
  // contract, never to a member's personal account.
  return Ok(undefined);
});

interface ValidateOrganizationSubscriptionChangeParameters
  extends AuthenticatedRequest {
  organizationId: string;
  plan?: "starter" | "standard" | "pro";
  returnPath?: string;
  seats?: number;
}

export const validateOrganizationSubscriptionChange = withSession<
  ValidateOrganizationSubscriptionChangeParameters,
  Result<void, ActionError>
>(async ({ organizationId, plan, returnPath, seats }) => {
  const parsed = validateOrganizationSubscriptionChangeSchema.safeParse({
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
    await assertOrganizationSubscriptionChangeAllowed(
      parsed.data.organizationId,
      prisma,
    );

    return Ok(undefined);
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
    return Err(parseBetterAuthActionError(error));
  }
});
