"use server";

import * as z from "zod";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { vendorGrantService } from "@/lib/services/vendor-grant.service";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const vendorGrantActionSchema = z.object({
  organizationId: z.string().min(1),
  grantId: z.string().uuid(),
});

const createVendorGrantActionSchema = z.object({
  organizationId: z.string().min(1),
  vendorId: z.string().uuid(),
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
  organizationId: string;
  grantId: string;
}

interface CreateVendorGrantParameters extends AuthenticatedRequest {
  organizationId: string;
  vendorId: string;
}

export const approveOrganizationVendorGrant = withSession<
  VendorGrantMutationParameters,
  Result<{ grantId: string }, ActionError>
>(async ({ organizationId, grantId }) => {
  const parsed = vendorGrantActionSchema.safeParse({ organizationId, grantId });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    const grant = await vendorGrantService.approveVendorGrant(
      parsed.data.organizationId,
      parsed.data.grantId,
    );
    return Ok({ grantId: grant.id });
  } catch (error) {
    console.error("Failed to approve vendor grant", error);
    return Err(parseVendorGrantActionError(error));
  }
});

export const denyOrganizationVendorGrant = withSession<
  VendorGrantMutationParameters,
  Result<{ grantId: string }, ActionError>
>(async ({ organizationId, grantId }) => {
  const parsed = vendorGrantActionSchema.safeParse({ organizationId, grantId });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    const grant = await vendorGrantService.denyVendorGrant(
      parsed.data.organizationId,
      parsed.data.grantId,
    );
    return Ok({ grantId: grant.id });
  } catch (error) {
    console.error("Failed to deny vendor grant", error);
    return Err(parseVendorGrantActionError(error));
  }
});

export const revokeOrganizationVendorGrant = withSession<
  VendorGrantMutationParameters,
  Result<{ grantId: string }, ActionError>
>(async ({ organizationId, grantId }) => {
  const parsed = vendorGrantActionSchema.safeParse({ organizationId, grantId });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    const grant = await vendorGrantService.revokeVendorGrant(
      parsed.data.organizationId,
      parsed.data.grantId,
    );
    return Ok({ grantId: grant.id });
  } catch (error) {
    console.error("Failed to revoke vendor grant", error);
    return Err(parseVendorGrantActionError(error));
  }
});

export const createOrganizationVendorGrant = withSession<
  CreateVendorGrantParameters,
  Result<{ grantId: string }, ActionError>
>(async ({ organizationId, vendorId }) => {
  const parsed = createVendorGrantActionSchema.safeParse({
    organizationId,
    vendorId,
  });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    const grant = await vendorGrantService.createVendorGrant(
      parsed.data.organizationId,
      parsed.data.vendorId,
    );
    return Ok({ grantId: grant.id });
  } catch (error) {
    console.error("Failed to create vendor grant", error);
    return Err(parseVendorGrantActionError(error));
  }
});
