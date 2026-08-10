"use server";

import { err, ok } from "neverthrow";
import * as z from "zod";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { coworkerAccessService } from "@/lib/services/coworker-access.service";
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
    ActionResultDto<{ accessId: string }, ActionError>
  >(async ({ organizationId, accessId }) => {
    const parsed = coworkerAccessActionSchema.safeParse({
      organizationId,
      accessId,
    });
    if (!parsed.success) {
      return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
    }

    try {
      const access = await coworkerAccessService[method](parsed.data.accessId, {
        type: "organization",
        organizationId: parsed.data.organizationId,
      });
      return toActionResult(ok({ accessId: access.id }));
    } catch (error) {
      console.error(`Failed to ${method} organization coworker access`, error);
      return toActionResult(err(toCoreApiActionError(error)));
    }
  });
}

export const approveOrganizationCoworkerAccess =
  organizationCoworkerAccessAction("approve");
export const denyOrganizationCoworkerAccess =
  organizationCoworkerAccessAction("deny");
export const revokeOrganizationCoworkerAccess =
  organizationCoworkerAccessAction("revoke");
