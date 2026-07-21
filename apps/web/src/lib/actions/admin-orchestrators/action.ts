"use server";

import { revalidatePath } from "next/cache";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import {
  ADMIN_ORCHESTRATOR_CAPTION_MAX_LENGTH,
  ADMIN_ORCHESTRATOR_NAME_MIN_LENGTH,
} from "@/lib/constants/orchestrator-display";
import {
  type AdminOrchestratorDisplayPatchBody,
  type AdminOrchestratorImageIntent,
  adminOrchestratorService,
  type UpdateAdminOrchestratorDisplayResult,
} from "@/lib/services/admin-orchestrator.service";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

function revalidateOrchestratorRoutes(id?: string) {
  revalidatePath("/admin/orchestrators");
  if (id) {
    revalidatePath(`/admin/orchestrators/${id}`);
  }
}

function mapError(error: unknown): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      message: error.message,
    };
  }

  return toCoreApiActionError(error);
}

/** Client payload may include non-display keys (e.g. slug); they are dropped. */
interface UntrustedOrchestratorDisplayPatch {
  name?: string;
  caption?: string | null;
  description?: string | null;
  slug?: string;
}

interface UpdateAdminOrchestratorDisplayParameters
  extends AuthenticatedRequest {
  id: string;
  patchBody?: UntrustedOrchestratorDisplayPatch;
  imageIntent?: AdminOrchestratorImageIntent;
  imageFile?: File;
}

/**
 * Pick display fields only — never slug — and validate name/caption.
 * Returns Err when name or caption fail local rules.
 */
function sanitizeDisplayPatchBody(
  patchBody: UntrustedOrchestratorDisplayPatch | undefined,
): Result<AdminOrchestratorDisplayPatchBody | undefined, ActionError> {
  if (!patchBody) {
    return Ok(undefined);
  }

  const sanitized: AdminOrchestratorDisplayPatchBody = {};

  if (patchBody.name !== undefined) {
    const name = patchBody.name.trim();
    if (name.length < ADMIN_ORCHESTRATOR_NAME_MIN_LENGTH) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: `Name must be at least ${ADMIN_ORCHESTRATOR_NAME_MIN_LENGTH} characters`,
      });
    }
    sanitized.name = name;
  }

  if (patchBody.caption !== undefined) {
    if (
      patchBody.caption !== null &&
      patchBody.caption.length > ADMIN_ORCHESTRATOR_CAPTION_MAX_LENGTH
    ) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: `Caption must be at most ${ADMIN_ORCHESTRATOR_CAPTION_MAX_LENGTH} characters`,
      });
    }
    sanitized.caption = patchBody.caption;
  }

  if (patchBody.description !== undefined) {
    sanitized.description = patchBody.description;
  }

  return Ok(Object.keys(sanitized).length > 0 ? sanitized : undefined);
}

export const updateAdminOrchestratorDisplayAction = withSession<
  UpdateAdminOrchestratorDisplayParameters,
  Result<UpdateAdminOrchestratorDisplayResult, ActionError>
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
        message: "No orchestrator changes to save",
      });
    }

    if (imageIntent === "upload" && !imageFile) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: "Image file is required for upload",
      });
    }

    const result = await adminOrchestratorService.updateDisplay({
      id,
      patchBody: safePatchBody,
      imageIntent,
      imageFile,
    });

    revalidateOrchestratorRoutes(id);
    return Ok(result);
  } catch (error) {
    return Err(mapError(error));
  }
});
