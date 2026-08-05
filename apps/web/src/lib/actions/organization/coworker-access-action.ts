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

export const approveOrganizationCoworkerAccess = withSession<
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
    const access = await coworkerAccessService.approve(parsed.data.accessId, {
      type: "organization",
      organizationId: parsed.data.organizationId,
    });
    return Ok({ accessId: access.id });
  } catch (error) {
    console.error("Failed to approve organization coworker access", error);
    return Err(toCoreApiActionError(error));
  }
});

export const denyOrganizationCoworkerAccess = withSession<
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
    const access = await coworkerAccessService.deny(parsed.data.accessId, {
      type: "organization",
      organizationId: parsed.data.organizationId,
    });
    return Ok({ accessId: access.id });
  } catch (error) {
    console.error("Failed to deny organization coworker access", error);
    return Err(toCoreApiActionError(error));
  }
});

export const revokeOrganizationCoworkerAccess = withSession<
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
    const access = await coworkerAccessService.revoke(parsed.data.accessId, {
      type: "organization",
      organizationId: parsed.data.organizationId,
    });
    return Ok({ accessId: access.id });
  } catch (error) {
    console.error("Failed to revoke organization coworker access", error);
    return Err(toCoreApiActionError(error));
  }
});
