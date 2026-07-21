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

export const updateAdminOrchestratorDisplayAction = withSession<
  UpdateAdminOrchestratorDisplayParameters,
  Result<UpdateAdminOrchestratorDisplayResult, ActionError>
>(async ({ session, id, patchBody, imageIntent = "none", imageFile }) => {
  try {
    assertAdminSession(session);

    const hasPatchBody = patchBody && Object.keys(patchBody).length > 0;
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
      patchBody: hasPatchBody ? patchBody : undefined,
      imageIntent,
      imageFile,
    });

    revalidateOrchestratorRoutes(id);
    return Ok(result);
  } catch (error) {
    return Err(mapError(error));
  }
});
