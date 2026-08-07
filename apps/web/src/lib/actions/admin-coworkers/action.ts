"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";

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
import { Err, Ok, type Result } from "@/lib/ts-res";
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
  Result<UpdateCoworkerDisplayResult, ActionError>
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
      return Err(validatedInput.error);
    }

    const result = await adminCoworkerService.updateDisplay(
      validatedInput.value,
    );

    revalidateAdminCoworkerRoutes(validatedInput.value.id);
    return Ok(result);
  } catch (error) {
    return Err(mapCoreError(error));
  }
});

interface UpdateAdminCoworkerControlsParameters extends AuthenticatedRequest {
  id: string;
  capabilities?: AdminCoworkerCapability[];
  priority?: number;
}

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
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: `Invalid capability: ${invalidCapability}`,
      });
    }
    patchBody.capabilities = capabilities;
  }

  if (input.priority !== undefined) {
    if (!Number.isInteger(input.priority)) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: "Priority must be an integer",
      });
    }
    patchBody.priority = input.priority;
  }

  if (Object.keys(patchBody).length === 0) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
      message: "No coworker control changes to save",
    });
  }

  return Ok(patchBody);
}

export const updateAdminCoworkerControlsAction = withSession<
  UpdateAdminCoworkerControlsParameters,
  Result<
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
    if (!sanitizeResult.ok) {
      return sanitizeResult;
    }

    const coworker = await adminCoworkerService.updateControls(
      id,
      sanitizeResult.data,
    );

    revalidateAdminCoworkerRoutes(id);
    return Ok({ coworker });
  } catch (error) {
    return Err(mapCoreError(error));
  }
});

interface UpdateAdminCoworkerWhitelistParameters extends AuthenticatedRequest {
  id: string;
  isWhitelisted: boolean;
}

export const updateAdminCoworkerWhitelistAction = withSession<
  UpdateAdminCoworkerWhitelistParameters,
  Result<
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
    return Ok({ coworker });
  } catch (error) {
    return Err(mapCoreError(error));
  }
});

interface ArchiveAdminCoworkerParameters extends AuthenticatedRequest {
  id: string;
}

export const archiveAdminCoworkerAction = withSession<
  ArchiveAdminCoworkerParameters,
  Result<
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
    return Ok({ coworker });
  } catch (error) {
    return Err(mapCoreError(error));
  }
});

interface UnarchiveAdminCoworkerParameters extends AuthenticatedRequest {
  id: string;
}

export const unarchiveAdminCoworkerAction = withSession<
  UnarchiveAdminCoworkerParameters,
  Result<
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
    return Ok({ coworker });
  } catch (error) {
    return Err(mapCoreError(error));
  }
});

const grantCoworkerEarlyAccessSchema = z.object({
  coworkerId: z.string().uuid(),
  targetType: z.enum(["user", "organization"]),
  targetId: z.string().min(1),
});

interface GrantAdminCoworkerEarlyAccessParameters extends AuthenticatedRequest {
  coworkerId: string;
  targetType: "user" | "organization";
  targetId: string;
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
  Result<{ accessId: string; status: string }, ActionError>
>(async ({ session, coworkerId, targetType, targetId }) => {
  try {
    assertAdminSession(session);

    const parsed = grantCoworkerEarlyAccessSchema.safeParse({
      coworkerId,
      targetType,
      targetId,
    });
    if (!parsed.success) {
      return Err({ code: CommonErrorCode.BAD_INPUT });
    }

    const access = await coworkerAccessService.createForCoworker(
      parsed.data.coworkerId,
      toAccessTargetBody(parsed.data),
    );

    revalidateAdminCoworkerRoutes(parsed.data.coworkerId);
    return Ok({ accessId: access.id, status: access.status });
  } catch (error) {
    return Err(mapCoreError(error));
  }
});

export const revokeAdminCoworkerEarlyAccessAction = withSession<
  GrantAdminCoworkerEarlyAccessParameters,
  Result<{ accessId: string; status: string }, ActionError>
>(async ({ session, coworkerId, targetType, targetId }) => {
  try {
    assertAdminSession(session);

    const parsed = grantCoworkerEarlyAccessSchema.safeParse({
      coworkerId,
      targetType,
      targetId,
    });
    if (!parsed.success) {
      return Err({ code: CommonErrorCode.BAD_INPUT });
    }

    const access = await coworkerAccessService.forceRevokeForCoworker(
      parsed.data.coworkerId,
      toAccessTargetBody(parsed.data),
    );

    revalidateAdminCoworkerRoutes(parsed.data.coworkerId);
    return Ok({ accessId: access.id, status: access.status });
  } catch (error) {
    return Err(mapCoreError(error));
  }
});
