"use server";

import { OrganizationSubscriptionExclusivityError } from "@sokosumi/database/helpers";
import * as z from "zod";
import {
  type ActionError,
  betterAuthApiErrorSchema,
  CommonErrorCode,
} from "@/lib/actions/errors";
import { organizationSubscriptionService } from "@/lib/services";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

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
