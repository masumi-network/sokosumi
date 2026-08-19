"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import {
  type AdminTaskX402RefundReason,
  type AdminTaskX402ResolveReason,
  adminTaskX402PaymentService,
} from "@/lib/services/admin-task-x402-payment.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

function mapError(error: unknown): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return { code: CommonErrorCode.UNAUTHORIZED, message: error.message };
  }
  if (error instanceof CoreApiRequestError) {
    return {
      code:
        error.status === 404
          ? CommonErrorCode.NOT_FOUND
          : error.status === 409 || error.status === 422
            ? CommonErrorCode.BAD_INPUT
            : CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: error.message,
    };
  }
  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message:
      error instanceof Error
        ? error.message
        : "Failed to update task x402 payment",
  };
}

interface RefundTaskX402PaymentParameters extends AuthenticatedRequest {
  paymentId: string;
  reason: AdminTaskX402RefundReason;
}

export const refundTaskX402PaymentAction = withSession<
  RefundTaskX402PaymentParameters,
  ActionResultDto<void, ActionError>
>(async ({ session, paymentId, reason }) => {
  try {
    assertAdminSession(session);
    await adminTaskX402PaymentService.refundPayment(paymentId, reason);
    revalidatePath("/admin/x402-payments");
    return toActionResult(ok(undefined));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

interface ResolveTaskX402PaymentParameters extends AuthenticatedRequest {
  paymentId: string;
  reason: AdminTaskX402ResolveReason;
}

export const resolveTaskX402PaymentAction = withSession<
  ResolveTaskX402PaymentParameters,
  ActionResultDto<void, ActionError>
>(async ({ session, paymentId, reason }) => {
  try {
    assertAdminSession(session);
    await adminTaskX402PaymentService.resolvePayment(paymentId, reason);
    revalidatePath("/admin/x402-payments");
    return toActionResult(ok(undefined));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});
