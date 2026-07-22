"use server";

import { revalidatePath } from "next/cache";
import {
  sanitizeCoworkerDisplayPatchBody,
  type UntrustedCoworkerDisplayPatch,
} from "@/lib/actions/coworkers/sanitize-display-patch";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import {
  type CoworkerImageIntent,
  coworkerDisplayService,
  type UpdateCoworkerDisplayResult,
} from "@/lib/services/coworker-display.service";
import { developerCoworkerService } from "@/lib/services/developer-coworker.service";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

function revalidateDeveloperCoworkerRoutes(coworkerId?: string) {
  revalidatePath("/developer");
  if (coworkerId) {
    revalidatePath(`/developer/coworkers/${coworkerId}`);
  }
}

interface UpdateDeveloperCoworkerDisplayParameters
  extends AuthenticatedRequest {
  id: string;
  patchBody?: UntrustedCoworkerDisplayPatch;
  imageIntent?: CoworkerImageIntent;
  imageFile?: File;
}

export const updateDeveloperCoworkerDisplayAction = withSession<
  UpdateDeveloperCoworkerDisplayParameters,
  Result<UpdateCoworkerDisplayResult, ActionError>
>(
  async ({
    session: _session,
    id,
    patchBody,
    imageIntent = "none",
    imageFile,
  }) => {
    try {
      const ownedCoworker =
        await developerCoworkerService.getOwnedCoworkerById(id);
      if (!ownedCoworker) {
        return Err({
          code: CommonErrorCode.NOT_FOUND,
          message: "Coworker not found",
        });
      }

      const sanitizeResult = sanitizeCoworkerDisplayPatchBody(patchBody);
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

      const result = await coworkerDisplayService.updateDisplay({
        id,
        patchBody: safePatchBody,
        imageIntent,
        imageFile,
      });

      revalidateDeveloperCoworkerRoutes(id);
      return Ok(result);
    } catch (error) {
      return Err(toCoreApiActionError(error));
    }
  },
);
