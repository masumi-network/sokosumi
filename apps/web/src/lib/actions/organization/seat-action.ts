"use server";

import { err, ok } from "neverthrow";
import * as z from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";

import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { organizationSeatService } from "@/lib/services/organization-seat.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const organizationSeatActionSchema = z.object({
  memberId: z.string().min(1),
  organizationId: z.string().min(1),
});

function parseSeatActionError(error: unknown): ActionError {
  if (error instanceof Error) {
    const errorWithStatus = error as Error & { status?: unknown };
    if (errorWithStatus.status === "FORBIDDEN") {
      return {
        code: CommonErrorCode.UNAUTHORIZED,
        message: error.message,
      };
    }

    // CONFLICT is Core losing the serialization race on the seat write
    // (SOK-1007). There is no conflict code, and the message tells the user
    // to retry, so it travels as BAD_INPUT like the other recoverable errors.
    if (
      errorWithStatus.status === "BAD_REQUEST" ||
      errorWithStatus.status === "CONFLICT" ||
      errorWithStatus.status === "NOT_FOUND"
    ) {
      return {
        code: CommonErrorCode.BAD_INPUT,
        message: error.message,
      };
    }
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
  };
}

interface OrganizationSeatActionParameters extends AuthenticatedRequest {
  memberId: string;
  organizationId: string;
}

export const assignOrganizationSeat = withSession<
  OrganizationSeatActionParameters,
  ActionResultDto<{ memberId: string; seatAssignedAt: Date }, ActionError>
>(async ({ session, memberId, organizationId }) => {
  const parsed = organizationSeatActionSchema.safeParse({
    memberId,
    organizationId,
  });
  if (!parsed.success) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
      }),
    );
  }

  try {
    const result = await organizationSeatService.assignSeat(
      session.user.id,
      parsed.data.organizationId,
      parsed.data.memberId,
    );

    return toActionResult(ok(result));
  } catch (error) {
    console.error("Failed to assign organization seat", error);
    return toActionResult(err(parseSeatActionError(error)));
  }
});

export const unassignOrganizationSeat = withSession<
  OrganizationSeatActionParameters,
  ActionResultDto<{ memberId: string }, ActionError>
>(async ({ session, memberId, organizationId }) => {
  const parsed = organizationSeatActionSchema.safeParse({
    memberId,
    organizationId,
  });
  if (!parsed.success) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
      }),
    );
  }

  try {
    const result = await organizationSeatService.unassignSeat(
      session.user.id,
      parsed.data.organizationId,
      parsed.data.memberId,
    );

    return toActionResult(ok(result));
  } catch (error) {
    console.error("Failed to unassign organization seat", error);
    return toActionResult(err(parseSeatActionError(error)));
  }
});
