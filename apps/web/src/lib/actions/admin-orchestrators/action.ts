"use server";

import { revalidatePath } from "next/cache";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import {
  type AdminOrchestratorImageIntent,
  type AdminOrchestratorPatchBody,
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

interface UpdateAdminOrchestratorDisplayParameters
  extends AuthenticatedRequest {
  id: string;
  patchBody?: AdminOrchestratorPatchBody;
  imageIntent?: AdminOrchestratorImageIntent;
  imageFile?: File;
}

/** UI may only edit display fields — never slug. */
function sanitizeDisplayPatchBody(
  patchBody: AdminOrchestratorPatchBody | undefined,
): AdminOrchestratorPatchBody | undefined {
  if (!patchBody) {
    return undefined;
  }

  const sanitized: AdminOrchestratorPatchBody = {};
  if (patchBody.name !== undefined) {
    sanitized.name = patchBody.name;
  }
  if (patchBody.caption !== undefined) {
    sanitized.caption = patchBody.caption;
  }
  if (patchBody.description !== undefined) {
    sanitized.description = patchBody.description;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export const updateAdminOrchestratorDisplayAction = withSession<
  UpdateAdminOrchestratorDisplayParameters,
  Result<UpdateAdminOrchestratorDisplayResult, ActionError>
>(async ({ session, id, patchBody, imageIntent = "none", imageFile }) => {
  try {
    assertAdminSession(session);

    const safePatchBody = sanitizeDisplayPatchBody(patchBody);
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
