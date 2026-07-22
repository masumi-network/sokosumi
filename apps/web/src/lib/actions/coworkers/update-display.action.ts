"use server";

import { revalidatePath } from "next/cache";

import { validateCoworkerDisplayActionInput } from "@/lib/actions/coworkers/apply-display-action-input";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import {
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
  id: unknown;
  patchBody?: unknown;
  imageIntent?: unknown;
  imageFile?: unknown;
}

export const updateDeveloperCoworkerDisplayAction = withSession<
  UpdateDeveloperCoworkerDisplayParameters,
  Result<UpdateCoworkerDisplayResult, ActionError>
>(async ({ session: _session, id, patchBody, imageIntent, imageFile }) => {
  try {
    const validatedInput = validateCoworkerDisplayActionInput({
      id,
      patchBody,
      imageIntent,
      imageFile,
    });
    if (validatedInput.isErr()) {
      return Err(validatedInput.error);
    }

    const ownedCoworker = await developerCoworkerService.getOwnedCoworkerById(
      validatedInput.value.id,
    );
    if (!ownedCoworker) {
      return Err({
        code: CommonErrorCode.NOT_FOUND,
        message: "Coworker not found",
      });
    }

    const result = await coworkerDisplayService.updateDisplay(
      validatedInput.value,
    );

    revalidateDeveloperCoworkerRoutes(validatedInput.value.id);
    return Ok(result);
  } catch (error) {
    return Err(toCoreApiActionError(error));
  }
});
