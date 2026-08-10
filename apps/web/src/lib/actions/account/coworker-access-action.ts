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
  accessId: z.string().uuid(),
});

interface CoworkerAccessMutationParameters extends AuthenticatedRequest {
  accessId: string;
}

type PersonalAccessMutation = "approve" | "deny" | "revoke";

function personalCoworkerAccessAction(method: PersonalAccessMutation) {
  return withSession<
    CoworkerAccessMutationParameters,
    Result<{ accessId: string }, ActionError>
  >(async ({ accessId }) => {
    const parsed = coworkerAccessActionSchema.safeParse({ accessId });
    if (!parsed.success) {
      return Err({ code: CommonErrorCode.BAD_INPUT });
    }

    try {
      const access = await coworkerAccessService[method](parsed.data.accessId, {
        type: "personal",
      });
      return Ok({ accessId: access.id });
    } catch (error) {
      console.error(`Failed to ${method} personal coworker access`, error);
      return Err(toCoreApiActionError(error));
    }
  });
}

export const approveMyCoworkerAccess = personalCoworkerAccessAction("approve");
export const denyMyCoworkerAccess = personalCoworkerAccessAction("deny");
export const revokeMyCoworkerAccess = personalCoworkerAccessAction("revoke");
