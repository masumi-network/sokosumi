"use server";

import * as z from "zod";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { coworkerAccessService } from "@/lib/services/coworker-access.service";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const coworkerAccessActionSchema = z.object({
  organizationId: z.string().min(1),
  accessId: z.string().uuid(),
});

interface CoworkerAccessMutationParameters extends AuthenticatedRequest {
  organizationId: string;
  accessId: string;
}

type OrganizationAccessMutation = "approve" | "deny" | "revoke";

function organizationCoworkerAccessAction(method: OrganizationAccessMutation) {
  return withSession<
    CoworkerAccessMutationParameters,
    Result<{ accessId: string }, ActionError>
  >(async ({ organizationId, accessId }) => {
    const parsed = coworkerAccessActionSchema.safeParse({
      organizationId,
      accessId,
    });
    if (!parsed.success) {
      return Err({ code: CommonErrorCode.BAD_INPUT });
    }

    try {
      const access = await coworkerAccessService[method](parsed.data.accessId, {
        type: "organization",
        organizationId: parsed.data.organizationId,
      });
      return Ok({ accessId: access.id });
    } catch (error) {
      console.error(`Failed to ${method} organization coworker access`, error);
      return Err(toCoreApiActionError(error));
    }
  });
}

export const approveOrganizationCoworkerAccess =
  organizationCoworkerAccessAction("approve");
export const denyOrganizationCoworkerAccess =
  organizationCoworkerAccessAction("deny");
export const revokeOrganizationCoworkerAccess =
  organizationCoworkerAccessAction("revoke");
