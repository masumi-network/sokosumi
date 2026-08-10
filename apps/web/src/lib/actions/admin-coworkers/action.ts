"use server";

import { err, ok, type Result } from "neverthrow";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";

import { validateCoworkerDisplayActionInput } from "@/lib/actions/coworkers/apply-display-action-input";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import {
  ADMIN_COWORKER_CAPABILITIES,
  type AdminCoworkerCapability,
} from "@/lib/constants/coworker-display";
import {
  type AdminCoworkerControlsPatchBody,
  adminCoworkerService,
} from "@/lib/services/admin-coworker.service";
import { coworkerAccessService } from "@/lib/services/coworker-access.service";
import { type UpdateCoworkerDisplayResult } from "@/lib/services/coworker-display.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

function revalidateAdminCoworkerRoutes(coworkerId?: string) {
  revalidatePath("/admin/coworkers");
  if (coworkerId) {
    revalidatePath(`/admin/coworkers/${coworkerId}`);
  }
}

function mapCoreError(error: unknown): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      message: error.message,
    };
  }

  return toCoreApiActionError(error);
}

interface UpdateAdminCoworkerDisplayParameters extends AuthenticatedRequest {
  id: unknown;
  patchBody?: unknown;
  imageIntent?: unknown;
  imageFile?: unknown;
}

export const updateAdminCoworkerDisplayAction = withSession<
  UpdateAdminCoworkerDisplayParameters,
  ActionResultDto<UpdateCoworkerDisplayResult, ActionError>
>(async ({ session, id, patchBody, imageIntent, imageFile }) => {
  try {
    assertAdminSession(session);

    const validatedInput = validateCoworkerDisplayActionInput({
      id,
      patchBody,
      imageIntent,
      imageFile,
    });
    if (validatedInput.isErr()) {
      return toActionResult(err(validatedInput.error));
    }

    const result = await adminCoworkerService.updateDisplay(
      validatedInput.value,
    );

    revalidateAdminCoworkerRoutes(validatedInput.value.id);
    return toActionResult(ok(result));
  } catch (error) {
    return toActionResult(err(mapCoreError(error)));
  }
});

interface UpdateAdminCoworkerControlsParameters extends AuthenticatedRequest {
  id: string;
  capabilities?: AdminCoworkerCapability[];
  priority?: number;
}

/**
 * In-process validation only — returns neverthrow Result.
 * Map to ActionResultDto at the server-action boundary via toActionResult.
 */
function sanitizeControlsPatchBody(
  input: Pick<
    UpdateAdminCoworkerControlsParameters,
    "capabilities" | "priority"
  >,
): Result<AdminCoworkerControlsPatchBody, ActionError> {
  const patchBody: AdminCoworkerControlsPatchBody = {};

  if (input.capabilities !== undefined) {
    const capabilities = [...new Set(input.capabilities)].toSorted();
    const invalidCapability = capabilities.find(
      (capability) => !ADMIN_COWORKER_CAPABILITIES.includes(capability),
    );
    if (invalidCapability) {
      return err({
        code: CommonErrorCode.BAD_INPUT,
        message: `Invalid capability: ${invalidCapability}`,
      });
    }
    patchBody.capabilities = capabilities;
  }

  if (input.priority !== undefined) {
    if (!Number.isInteger(input.priority)) {
      return err({
        code: CommonErrorCode.BAD_INPUT,
        message: "Priority must be an integer",
      });
    }
    patchBody.priority = input.priority;
  }

  if (Object.keys(patchBody).length === 0) {
    return err({
      code: CommonErrorCode.BAD_INPUT,
      message: "No coworker control changes to save",
    });
  }

  return ok(patchBody);
}

export const updateAdminCoworkerControlsAction = withSession<
  UpdateAdminCoworkerControlsParameters,
  ActionResultDto<
    {
      coworker: Awaited<ReturnType<typeof adminCoworkerService.updateControls>>;
    },
    ActionError
  >
>(async ({ session, id, capabilities, priority }) => {
  try {
    assertAdminSession(session);

    const sanitizeResult = sanitizeControlsPatchBody({
      capabilities,
      priority,
    });
    if (sanitizeResult.isErr()) {
      return toActionResult(err(sanitizeResult.error));
    }

    const coworker = await adminCoworkerService.updateControls(
      id,
      sanitizeResult.value,
    );

    revalidateAdminCoworkerRoutes(id);
    return toActionResult(ok({ coworker }));
  } catch (error) {
    return toActionResult(err(mapCoreError(error)));
  }
});

interface UpdateAdminCoworkerWhitelistParameters extends AuthenticatedRequest {
  id: string;
  isWhitelisted: boolean;
}

export const updateAdminCoworkerWhitelistAction = withSession<
  UpdateAdminCoworkerWhitelistParameters,
  ActionResultDto<
    {
      coworker: Awaited<
        ReturnType<typeof adminCoworkerService.updateWhitelist>
      >;
    },
    ActionError
  >
>(async ({ session, id, isWhitelisted }) => {
  try {
    assertAdminSession(session);

    const coworker = await adminCoworkerService.updateWhitelist(
      id,
      isWhitelisted,
    );

    revalidateAdminCoworkerRoutes(id);
    return toActionResult(ok({ coworker }));
  } catch (error) {
    return toActionResult(err(mapCoreError(error)));
  }
});

interface ArchiveAdminCoworkerParameters extends AuthenticatedRequest {
  id: string;
}

export const archiveAdminCoworkerAction = withSession<
  ArchiveAdminCoworkerParameters,
  ActionResultDto<
    {
      coworker: Awaited<
        ReturnType<typeof adminCoworkerService.archiveCoworker>
      >;
    },
    ActionError
  >
>(async ({ session, id }) => {
  try {
    assertAdminSession(session);

    const coworker = await adminCoworkerService.archiveCoworker(id);

    revalidateAdminCoworkerRoutes(id);
    return toActionResult(ok({ coworker }));
  } catch (error) {
    return toActionResult(err(mapCoreError(error)));
  }
});

interface UnarchiveAdminCoworkerParameters extends AuthenticatedRequest {
  id: string;
}

export const unarchiveAdminCoworkerAction = withSession<
  UnarchiveAdminCoworkerParameters,
  ActionResultDto<
    {
      coworker: Awaited<
        ReturnType<typeof adminCoworkerService.unarchiveCoworker>
      >;
    },
    ActionError
  >
>(async ({ session, id }) => {
  try {
    assertAdminSession(session);

    const coworker = await adminCoworkerService.unarchiveCoworker(id);

    revalidateAdminCoworkerRoutes(id);
    return toActionResult(ok({ coworker }));
  } catch (error) {
    return toActionResult(err(mapCoreError(error)));
  }
});

const grantCoworkerEarlyAccessSchema = z.object({
  coworkerId: z.string().uuid(),
  targetType: z.enum(["user", "organization"]),
  targetId: z.string().min(1),
});

const revokeCoworkerEarlyAccessByWorkspaceSchema = z.object({
  coworkerId: z.string().uuid(),
  workspaceId: z.string().uuid(),
});

interface GrantAdminCoworkerEarlyAccessParameters extends AuthenticatedRequest {
  coworkerId: string;
  targetType: "user" | "organization";
  targetId: string;
}

interface RevokeAdminCoworkerEarlyAccessParameters
  extends AuthenticatedRequest {
  coworkerId: string;
  workspaceId: string;
}

function toAccessTargetBody(parsed: {
  targetType: "user" | "organization";
  targetId: string;
}): { userId: string } | { organizationId: string } {
  if (parsed.targetType === "user") {
    return { userId: parsed.targetId };
  }
  return { organizationId: parsed.targetId };
}

export const grantAdminCoworkerEarlyAccessAction = withSession<
  GrantAdminCoworkerEarlyAccessParameters,
  ActionResultDto<{ accessId: string; status: string }, ActionError>
>(async ({ session, coworkerId, targetType, targetId }) => {
  try {
    assertAdminSession(session);

    const parsed = grantCoworkerEarlyAccessSchema.safeParse({
      coworkerId,
      targetType,
      targetId,
    });
    if (!parsed.success) {
      return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
    }

    const access = await coworkerAccessService.createForCoworker(
      parsed.data.coworkerId,
      toAccessTargetBody(parsed.data),
    );

    revalidateAdminCoworkerRoutes(parsed.data.coworkerId);
    return toActionResult(ok({ accessId: access.id, status: access.status }));
  } catch (error) {
    return toActionResult(err(mapCoreError(error)));
  }
});

/** Revoke GRANTED access for a list row (by workspace id). */
export const revokeAdminCoworkerEarlyAccessAction = withSession<
  RevokeAdminCoworkerEarlyAccessParameters,
  ActionResultDto<{ accessId: string; status: string }, ActionError>
>(async ({ session, coworkerId, workspaceId }) => {
  try {
    assertAdminSession(session);

    const parsed = revokeCoworkerEarlyAccessByWorkspaceSchema.safeParse({
      coworkerId,
      workspaceId,
    });
    if (!parsed.success) {
      return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
    }

    const access = await coworkerAccessService.forceRevokeForCoworker(
      parsed.data.coworkerId,
      { workspaceId: parsed.data.workspaceId },
    );

    revalidateAdminCoworkerRoutes(parsed.data.coworkerId);
    return toActionResult(ok({ accessId: access.id, status: access.status }));
  } catch (error) {
    return toActionResult(err(mapCoreError(error)));
  }
});
