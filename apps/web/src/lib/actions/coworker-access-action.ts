"use server";

import { err, ok } from "neverthrow";
import * as z from "zod";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { coworkerAccessService } from "@/lib/services/coworker-access.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const personalAccessSchema = z.object({
  accessId: z.string().uuid(),
});

const organizationAccessSchema = z.object({
  organizationId: z.string().min(1),
  accessId: z.string().uuid(),
});

interface PersonalAccessMutationParameters extends AuthenticatedRequest {
  accessId: string;
}

interface OrganizationAccessMutationParameters extends AuthenticatedRequest {
  organizationId: string;
  accessId: string;
}

type CoworkerAccessScope = "personal" | "organization";
type CoworkerAccessMutation = "approve" | "deny" | "revoke";
type CoworkerAccessActionResult = ActionResultDto<
  { accessId: string },
  ActionError
>;

function coworkerAccessAction(
  scope: "personal",
  method: CoworkerAccessMutation,
): (
  params: PersonalAccessMutationParameters,
) => Promise<CoworkerAccessActionResult>;
function coworkerAccessAction(
  scope: "organization",
  method: CoworkerAccessMutation,
): (
  params: OrganizationAccessMutationParameters,
) => Promise<CoworkerAccessActionResult>;
function coworkerAccessAction(
  scope: CoworkerAccessScope,
  method: CoworkerAccessMutation,
) {
  if (scope === "personal") {
    return withSession<
      PersonalAccessMutationParameters,
      ActionResultDto<{ accessId: string }, ActionError>
    >(async ({ accessId }) => {
      const parsed = personalAccessSchema.safeParse({ accessId });
      if (!parsed.success) {
        return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
      }

      try {
        const access = await coworkerAccessService[method](
          parsed.data.accessId,
          { type: "personal" },
        );
        return toActionResult(ok({ accessId: access.id }));
      } catch (error) {
        console.error(`Failed to ${method} personal coworker access`, error);
        return toActionResult(err(toCoreApiActionError(error)));
      }
    });
  }

  return withSession<
    OrganizationAccessMutationParameters,
    ActionResultDto<{ accessId: string }, ActionError>
  >(async ({ organizationId, accessId }) => {
    const parsed = organizationAccessSchema.safeParse({
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

export const approveMyCoworkerAccess = coworkerAccessAction(
  "personal",
  "approve",
);
export const denyMyCoworkerAccess = coworkerAccessAction("personal", "deny");
export const revokeMyCoworkerAccess = coworkerAccessAction(
  "personal",
  "revoke",
);

export const approveOrganizationCoworkerAccess = coworkerAccessAction(
  "organization",
  "approve",
);
export const denyOrganizationCoworkerAccess = coworkerAccessAction(
  "organization",
  "deny",
);
export const revokeOrganizationCoworkerAccess = coworkerAccessAction(
  "organization",
  "revoke",
);
