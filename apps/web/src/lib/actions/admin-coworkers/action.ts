"use server";

import { revalidatePath } from "next/cache";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import {
  ADMIN_COWORKER_CAPTION_MAX_LENGTH,
  ADMIN_COWORKER_NAME_MIN_LENGTH,
} from "@/lib/constants/coworker-display";
import {
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
    if (
      patchBody.caption !== null &&
      patchBody.caption.length > ADMIN_COWORKER_CAPTION_MAX_LENGTH
    ) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: `Caption must be at most ${ADMIN_COWORKER_CAPTION_MAX_LENGTH} characters`,
      });
    }
    sanitized.caption = patchBody.caption;
  }

  if (patchBody.description !== undefined) {
    sanitized.description = patchBody.description;
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
