"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
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

const grantCoworkerEarlyAccessSchema = z.object({
  coworkerId: z.string().uuid(),
  targetType: z.enum(["user", "organization"]),
  targetValue: z.string().trim().min(1),
});

interface GrantDeveloperCoworkerEarlyAccessParameters
  extends AuthenticatedRequest {
  coworkerId: string;
  targetType: "user" | "organization";
  /** User email or organization slug. */
  targetValue: string;
}

function toAccessTargetBody(parsed: {
  targetType: "user" | "organization";
  targetValue: string;
}): { email: string } | { organizationSlug: string } {
  const value = parsed.targetValue.trim();
  if (parsed.targetType === "user") {
    return { email: value };
  }
  return { organizationSlug: value };
}

/**
 * Vendor admin dogfood / propose: Core decides GRANTED (member workspace)
 * vs PENDING (foreign). Target by email (personal) or organization slug.
 */
export const grantDeveloperCoworkerEarlyAccessAction = withSession<
  GrantDeveloperCoworkerEarlyAccessParameters,
  ActionResultDto<{ accessId: string; status: string }, ActionError>
>(async ({ coworkerId, targetType, targetValue }) => {
  const parsed = grantCoworkerEarlyAccessSchema.safeParse({
    coworkerId,
    targetType,
    targetValue,
  });
  if (!parsed.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  if (parsed.data.targetType === "user") {
    const emailCheck = z
      .string()
      .email()
      .safeParse(parsed.data.targetValue.trim());
    if (!emailCheck.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Enter a valid email address",
        }),
      );
    }
  }

  try {
    const access = await coworkerAccessService.createForCoworker(
      parsed.data.coworkerId,
      toAccessTargetBody(parsed.data),
    );

    revalidatePath(`/developer/coworkers/${parsed.data.coworkerId}`);
    revalidatePath("/developer/coworkers");
    return toActionResult(ok({ accessId: access.id, status: access.status }));
  } catch (error) {
    console.error("Failed to grant developer coworker early access", error);
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

const revokeCoworkerEarlyAccessByWorkspaceSchema = z.object({
  coworkerId: z.string().uuid(),
  workspaceId: z.string().uuid(),
});

interface RevokeDeveloperCoworkerEarlyAccessParameters
  extends AuthenticatedRequest {
  coworkerId: string;
  workspaceId: string;
}

/** Revoke GRANTED access for a list row (vendor admin of the coworker). */
export const revokeDeveloperCoworkerEarlyAccessAction = withSession<
  RevokeDeveloperCoworkerEarlyAccessParameters,
  ActionResultDto<{ accessId: string; status: string }, ActionError>
>(async ({ coworkerId, workspaceId }) => {
  const parsed = revokeCoworkerEarlyAccessByWorkspaceSchema.safeParse({
    coworkerId,
    workspaceId,
  });
  if (!parsed.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    const access = await coworkerAccessService.forceRevokeForCoworker(
      parsed.data.coworkerId,
      { workspaceId: parsed.data.workspaceId },
    );

    revalidatePath(`/developer/coworkers/${parsed.data.coworkerId}`);
    revalidatePath("/developer/coworkers");
    return toActionResult(ok({ accessId: access.id, status: access.status }));
  } catch (error) {
    console.error("Failed to revoke developer coworker early access", error);
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
