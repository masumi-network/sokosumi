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
  accessId: z.string().uuid(),
});

interface CoworkerAccessMutationParameters extends AuthenticatedRequest {
  accessId: string;
}

type PersonalAccessMutation = "approve" | "deny" | "revoke";

function personalCoworkerAccessAction(method: PersonalAccessMutation) {
  return withSession<
    CoworkerAccessMutationParameters,
    ActionResultDto<{ accessId: string }, ActionError>
  >(async ({ accessId }) => {
    const parsed = coworkerAccessActionSchema.safeParse({ accessId });
    if (!parsed.success) {
      return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
    }

    try {
      const access = await coworkerAccessService[method](parsed.data.accessId, {
        type: "personal",
      });
      return toActionResult(ok({ accessId: access.id }));
    } catch (error) {
      console.error(`Failed to ${method} personal coworker access`, error);
      return toActionResult(err(toCoreApiActionError(error)));
    }
  });
}

export const approveMyCoworkerAccess = personalCoworkerAccessAction("approve");
export const denyMyCoworkerAccess = personalCoworkerAccessAction("deny");
export const revokeMyCoworkerAccess = personalCoworkerAccessAction("revoke");
