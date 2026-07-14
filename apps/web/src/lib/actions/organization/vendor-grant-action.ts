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
  organizationId: z.string().min(1),
  grantId: z.string().uuid(),
});

const vendorPermissionSchema = z.enum([
  "task:read",
  "task:comment",
  "task:create",
]);

const createVendorGrantActionSchema = z
  .object({
    organizationId: z.string().min(1),
    vendorId: z.string().uuid(),
    permissions: z.array(vendorPermissionSchema).min(1),
  })
  .refine(
    (data) => new Set(data.permissions).size === data.permissions.length,
    { path: ["permissions"] },
  );

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
  permissions: VendorGrantPermission[];
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
  Result<{ grantIds: string[] }, ActionError>
>(async ({ organizationId, vendorId, permissions }) => {
  const parsed = createVendorGrantActionSchema.safeParse({
    organizationId,
    vendorId,
    permissions,
  });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    const grants = await vendorGrantService.createVendorGrant(
      parsed.data.organizationId,
      parsed.data.vendorId,
      parsed.data.permissions,
    );
    return Ok({ grantIds: grants.map((grant) => grant.id) });
  } catch (error) {
    console.error("Failed to create vendor grant", error);
    return Err(parseVendorGrantActionError(error));
  }
});
