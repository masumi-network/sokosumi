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

const personalGrantIdSchema = z.object({
  grantId: z.string().uuid(),
});

const organizationGrantIdSchema = z.object({
  organizationId: z.string().min(1),
  grantId: z.string().uuid(),
});

const personalCreateSchema = z.object({
  vendorId: z.string().uuid(),
});

const organizationCreateSchema = z.object({
  organizationId: z.string().min(1),
  vendorId: z.string().uuid(),
});

interface PersonalGrantMutationParameters extends AuthenticatedRequest {
  grantId: string;
}

interface OrganizationGrantMutationParameters extends AuthenticatedRequest {
  organizationId: string;
  grantId: string;
}

interface PersonalCreateGrantParameters extends AuthenticatedRequest {
  vendorId: string;
}

interface OrganizationCreateGrantParameters extends AuthenticatedRequest {
  organizationId: string;
  vendorId: string;
}

type VendorGrantScope = "personal" | "organization";
type VendorGrantMutation = "approve" | "deny" | "revoke";
type VendorGrantActionResult = ActionResultDto<
  { grantId: string },
  ActionError
>;

const PERSONAL_MUTATIONS = {
  approve: vendorGrantService.approveMyVendorGrant,
  deny: vendorGrantService.denyMyVendorGrant,
  revoke: vendorGrantService.revokeMyVendorGrant,
} as const;

const ORGANIZATION_MUTATIONS = {
  approve: vendorGrantService.approveVendorGrant,
  deny: vendorGrantService.denyVendorGrant,
  revoke: vendorGrantService.revokeVendorGrant,
} as const;

function vendorGrantMutationAction(
  scope: "personal",
  method: VendorGrantMutation,
): (
  params: PersonalGrantMutationParameters,
) => Promise<VendorGrantActionResult>;
function vendorGrantMutationAction(
  scope: "organization",
  method: VendorGrantMutation,
): (
  params: OrganizationGrantMutationParameters,
) => Promise<VendorGrantActionResult>;
function vendorGrantMutationAction(
  scope: VendorGrantScope,
  method: VendorGrantMutation,
) {
  if (scope === "personal") {
    return withSession<
      PersonalGrantMutationParameters,
      VendorGrantActionResult
    >(async ({ grantId }) => {
      const parsed = personalGrantIdSchema.safeParse({ grantId });
      if (!parsed.success) {
        return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
      }

      try {
        const grant = await PERSONAL_MUTATIONS[method](parsed.data.grantId);
        return toActionResult(ok({ grantId: grant.id }));
      } catch (error) {
        console.error(`Failed to ${method} personal vendor grant`, error);
        return toActionResult(err(toCoreApiActionError(error)));
      }
    });
  }

  return withSession<
    OrganizationGrantMutationParameters,
    VendorGrantActionResult
  >(async ({ organizationId, grantId }) => {
    const parsed = organizationGrantIdSchema.safeParse({
      organizationId,
      grantId,
    });
    if (!parsed.success) {
      return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
    }

    try {
      const grant = await ORGANIZATION_MUTATIONS[method](
        parsed.data.organizationId,
        parsed.data.grantId,
      );
      return toActionResult(ok({ grantId: grant.id }));
    } catch (error) {
      console.error(`Failed to ${method} organization vendor grant`, error);
      return toActionResult(err(toCoreApiActionError(error)));
    }
  });
}

function vendorGrantCreateAction(
  scope: "personal",
): (params: PersonalCreateGrantParameters) => Promise<VendorGrantActionResult>;
function vendorGrantCreateAction(
  scope: "organization",
): (
  params: OrganizationCreateGrantParameters,
) => Promise<VendorGrantActionResult>;
function vendorGrantCreateAction(scope: VendorGrantScope) {
  if (scope === "personal") {
    return withSession<PersonalCreateGrantParameters, VendorGrantActionResult>(
      async ({ vendorId }) => {
        const parsed = personalCreateSchema.safeParse({ vendorId });
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
      },
    );
  }

  return withSession<
    OrganizationCreateGrantParameters,
    VendorGrantActionResult
  >(async ({ organizationId, vendorId }) => {
    const parsed = organizationCreateSchema.safeParse({
      organizationId,
      vendorId,
    });
    if (!parsed.success) {
      return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
    }

    try {
      const grant = await vendorGrantService.createVendorGrant(
        parsed.data.organizationId,
        parsed.data.vendorId,
      );
      return toActionResult(ok({ grantId: grant.id }));
    } catch (error) {
      console.error("Failed to create organization vendor grant", error);
      return toActionResult(err(toCoreApiActionError(error)));
    }
  });
}

export const approveMyVendorGrant = vendorGrantMutationAction(
  "personal",
  "approve",
);
export const denyMyVendorGrant = vendorGrantMutationAction("personal", "deny");
export const revokeMyVendorGrant = vendorGrantMutationAction(
  "personal",
  "revoke",
);
export const createMyVendorGrant = vendorGrantCreateAction("personal");

export const approveOrganizationVendorGrant = vendorGrantMutationAction(
  "organization",
  "approve",
);
export const denyOrganizationVendorGrant = vendorGrantMutationAction(
  "organization",
  "deny",
);
export const revokeOrganizationVendorGrant = vendorGrantMutationAction(
  "organization",
  "revoke",
);
export const createOrganizationVendorGrant =
  vendorGrantCreateAction("organization");
