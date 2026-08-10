"use server";

import { err, ok } from "neverthrow";
import * as z from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { vendorGrantService } from "@/lib/services/vendor-grant.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const vendorGrantActionSchema = z.object({
  grantId: z.string().uuid(),
});

const createVendorGrantActionSchema = z.object({
  vendorId: z.string().uuid(),
});

interface VendorGrantMutationParameters extends AuthenticatedRequest {
  grantId: string;
}

interface CreateVendorGrantParameters extends AuthenticatedRequest {
  vendorId: string;
}

export const approveMyVendorGrant = withSession<
  VendorGrantMutationParameters,
  ActionResultDto<{ grantId: string }, ActionError>
>(async ({ grantId }) => {
  const parsed = vendorGrantActionSchema.safeParse({ grantId });
  if (!parsed.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    const grant = await vendorGrantService.approveMyVendorGrant(
      parsed.data.grantId,
    );
    return toActionResult(ok({ grantId: grant.id }));
  } catch (error) {
    console.error("Failed to approve personal vendor grant", error);
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const denyMyVendorGrant = withSession<
  VendorGrantMutationParameters,
  ActionResultDto<{ grantId: string }, ActionError>
>(async ({ grantId }) => {
  const parsed = vendorGrantActionSchema.safeParse({ grantId });
  if (!parsed.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    const grant = await vendorGrantService.denyMyVendorGrant(
      parsed.data.grantId,
    );
    return toActionResult(ok({ grantId: grant.id }));
  } catch (error) {
    console.error("Failed to deny personal vendor grant", error);
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const revokeMyVendorGrant = withSession<
  VendorGrantMutationParameters,
  ActionResultDto<{ grantId: string }, ActionError>
>(async ({ grantId }) => {
  const parsed = vendorGrantActionSchema.safeParse({ grantId });
  if (!parsed.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    const grant = await vendorGrantService.revokeMyVendorGrant(
      parsed.data.grantId,
    );
    return toActionResult(ok({ grantId: grant.id }));
  } catch (error) {
    console.error("Failed to revoke personal vendor grant", error);
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const createMyVendorGrant = withSession<
  CreateVendorGrantParameters,
  ActionResultDto<{ grantId: string }, ActionError>
>(async ({ vendorId }) => {
  const parsed = createVendorGrantActionSchema.safeParse({ vendorId });
  if (!parsed.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    const grant = await vendorGrantService.createMyVendorGrant(
      parsed.data.vendorId,
    );
    return toActionResult(ok({ grantId: grant.id }));
  } catch (error) {
    console.error("Failed to create personal vendor grant", error);
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
