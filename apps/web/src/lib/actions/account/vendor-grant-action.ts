"use server";

import * as z from "zod";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import {
  type VendorGrantPermission,
  vendorGrantService,
} from "@/lib/services/vendor-grant.service";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const vendorGrantActionSchema = z.object({
  grantId: z.string().uuid(),
});

const createVendorGrantActionSchema = z.object({
  vendorId: z.string().uuid(),
  permission: z.enum(["task:read", "task:comment", "task:create"]),
});

function parseVendorGrantActionError(error: unknown): ActionError {
  if (error instanceof Error) {
    const errorWithStatus = error as Error & { status?: unknown };
    if (errorWithStatus.status === "FORBIDDEN") {
      return {
        code: CommonErrorCode.UNAUTHORIZED,
        message: error.message,
      };
    }

    if (
      errorWithStatus.status === "BAD_REQUEST" ||
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

interface VendorGrantMutationParameters extends AuthenticatedRequest {
  grantId: string;
}

interface CreateVendorGrantParameters extends AuthenticatedRequest {
  vendorId: string;
  permission: VendorGrantPermission;
}

export const approveMyVendorGrant = withSession<
  VendorGrantMutationParameters,
  Result<{ grantId: string }, ActionError>
>(async ({ grantId }) => {
  const parsed = vendorGrantActionSchema.safeParse({ grantId });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    const grant = await vendorGrantService.approveMyVendorGrant(
      parsed.data.grantId,
    );
    return Ok({ grantId: grant.id });
  } catch (error) {
    console.error("Failed to approve personal vendor grant", error);
    return Err(parseVendorGrantActionError(error));
  }
});

export const denyMyVendorGrant = withSession<
  VendorGrantMutationParameters,
  Result<{ grantId: string }, ActionError>
>(async ({ grantId }) => {
  const parsed = vendorGrantActionSchema.safeParse({ grantId });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    const grant = await vendorGrantService.denyMyVendorGrant(
      parsed.data.grantId,
    );
    return Ok({ grantId: grant.id });
  } catch (error) {
    console.error("Failed to deny personal vendor grant", error);
    return Err(parseVendorGrantActionError(error));
  }
});

export const revokeMyVendorGrant = withSession<
  VendorGrantMutationParameters,
  Result<{ grantId: string }, ActionError>
>(async ({ grantId }) => {
  const parsed = vendorGrantActionSchema.safeParse({ grantId });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    const grant = await vendorGrantService.revokeMyVendorGrant(
      parsed.data.grantId,
    );
    return Ok({ grantId: grant.id });
  } catch (error) {
    console.error("Failed to revoke personal vendor grant", error);
    return Err(parseVendorGrantActionError(error));
  }
});

export const createMyVendorGrant = withSession<
  CreateVendorGrantParameters,
  Result<{ grantId: string }, ActionError>
>(async ({ vendorId, permission }) => {
  const parsed = createVendorGrantActionSchema.safeParse({
    vendorId,
    permission,
  });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    const grant = await vendorGrantService.createMyVendorGrant(
      parsed.data.vendorId,
      parsed.data.permission,
    );
    return Ok({ grantId: grant.id });
  } catch (error) {
    console.error("Failed to create personal vendor grant", error);
    return Err(parseVendorGrantActionError(error));
  }
});
