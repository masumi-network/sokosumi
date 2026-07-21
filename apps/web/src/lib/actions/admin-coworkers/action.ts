"use server";

import { revalidatePath } from "next/cache";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import {
  ADMIN_COWORKER_CAPABILITIES,
  ADMIN_COWORKER_CAPTION_MAX_LENGTH,
  ADMIN_COWORKER_NAME_MIN_LENGTH,
  type AdminCoworkerCapability,
} from "@/lib/constants/coworker-display";
import {
  type AdminCoworkerControlsPatchBody,
  type AdminCoworkerDisplayPatchBody,
  type AdminCoworkerImageIntent,
  adminCoworkerService,
  type UpdateAdminCoworkerDisplayResult,
} from "@/lib/services/admin-coworker.service";
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

/** Client payload may include non-display keys; they are dropped. */
interface UntrustedCoworkerDisplayPatch {
  name?: string;
  caption?: string | null;
  description?: string | null;
  image?: string | null;
}

interface UpdateAdminCoworkerDisplayParameters extends AuthenticatedRequest {
  id: string;
  patchBody?: UntrustedCoworkerDisplayPatch;
  imageIntent?: AdminCoworkerImageIntent;
  imageFile?: File;
}

function sanitizeDisplayPatchBody(
  patchBody: UntrustedCoworkerDisplayPatch | undefined,
): Result<AdminCoworkerDisplayPatchBody | undefined, ActionError> {
  if (!patchBody) {
    return Ok(undefined);
  }

  const sanitized: AdminCoworkerDisplayPatchBody = {};

  if (patchBody.name !== undefined) {
    const name = patchBody.name.trim();
    if (name.length < ADMIN_COWORKER_NAME_MIN_LENGTH) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: `Name must be at least ${ADMIN_COWORKER_NAME_MIN_LENGTH} characters`,
      });
    }
    sanitized.name = name;
  }

  if (patchBody.caption !== undefined) {
    if (patchBody.caption === null) {
      sanitized.caption = null;
    } else {
      const caption = patchBody.caption.trim();
      if (caption.length === 0) {
        sanitized.caption = null;
      } else if (caption.length > ADMIN_COWORKER_CAPTION_MAX_LENGTH) {
        return Err({
          code: CommonErrorCode.BAD_INPUT,
          message: `Caption must be at most ${ADMIN_COWORKER_CAPTION_MAX_LENGTH} characters`,
        });
      } else {
        sanitized.caption = caption;
      }
    }
  }

  if (patchBody.description !== undefined) {
    if (patchBody.description === null) {
      sanitized.description = null;
    } else {
      const description = patchBody.description.trim();
      sanitized.description = description.length > 0 ? description : null;
    }
  }

  return Ok(Object.keys(sanitized).length > 0 ? sanitized : undefined);
}

export const updateAdminCoworkerDisplayAction = withSession<
  UpdateAdminCoworkerDisplayParameters,
  Result<UpdateAdminCoworkerDisplayResult, ActionError>
>(async ({ session, id, patchBody, imageIntent = "none", imageFile }) => {
  try {
    assertAdminSession(session);

    const sanitizeResult = sanitizeDisplayPatchBody(patchBody);
    if (!sanitizeResult.ok) {
      return sanitizeResult;
    }

    const safePatchBody = sanitizeResult.data;
    const hasPatchBody = Boolean(safePatchBody);
    if (!hasPatchBody && imageIntent === "none") {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: "No coworker changes to save",
      });
    }

    if (imageIntent === "upload" && !imageFile) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: "Image file is required for upload",
      });
    }

    const result = await adminCoworkerService.updateDisplay({
      id,
      patchBody: safePatchBody,
      imageIntent,
      imageFile,
    });

    revalidateAdminCoworkerRoutes(id);
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
