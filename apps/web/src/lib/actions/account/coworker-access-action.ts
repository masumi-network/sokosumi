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

export const approveMyCoworkerAccess = withSession<
  CoworkerAccessMutationParameters,
  Result<{ accessId: string }, ActionError>
>(async ({ accessId }) => {
  const parsed = coworkerAccessActionSchema.safeParse({ accessId });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    const access = await coworkerAccessService.approve(parsed.data.accessId, {
      type: "personal",
    });
    return Ok({ accessId: access.id });
  } catch (error) {
    console.error("Failed to approve personal coworker access", error);
    return Err(toCoreApiActionError(error));
  }
});

export const denyMyCoworkerAccess = withSession<
  CoworkerAccessMutationParameters,
  Result<{ accessId: string }, ActionError>
>(async ({ accessId }) => {
  const parsed = coworkerAccessActionSchema.safeParse({ accessId });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    const access = await coworkerAccessService.deny(parsed.data.accessId, {
      type: "personal",
    });
    return Ok({ accessId: access.id });
  } catch (error) {
    console.error("Failed to deny personal coworker access", error);
    return Err(toCoreApiActionError(error));
  }
});

export const revokeMyCoworkerAccess = withSession<
  CoworkerAccessMutationParameters,
  Result<{ accessId: string }, ActionError>
>(async ({ accessId }) => {
  const parsed = coworkerAccessActionSchema.safeParse({ accessId });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    const access = await coworkerAccessService.revoke(parsed.data.accessId, {
      type: "personal",
    });
    return Ok({ accessId: access.id });
  } catch (error) {
    console.error("Failed to revoke personal coworker access", error);
    return Err(toCoreApiActionError(error));
  }
});
