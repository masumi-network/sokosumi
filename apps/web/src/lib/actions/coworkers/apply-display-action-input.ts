import { err, ok, type Result } from "neverthrow";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import type {
  CoworkerDisplayPatchBody,
  CoworkerImageIntent,
} from "@/lib/services/coworker-display.service";

import { sanitizeCoworkerDisplayPatchBody } from "./sanitize-display-patch";
import {
  validateCoworkerDisplayActionId,
  validateCoworkerDisplayImageFile,
  validateCoworkerDisplayImageIntent,
} from "./validate-display-action-input";

export interface ValidatedCoworkerDisplayActionInput {
  id: string;
  patchBody?: CoworkerDisplayPatchBody;
  imageIntent: CoworkerImageIntent;
  imageFile?: File | Blob;
}

export function validateCoworkerDisplayActionInput(input: {
  id: unknown;
  patchBody?: unknown;
  imageIntent?: unknown;
  imageFile?: unknown;
}): Result<ValidatedCoworkerDisplayActionInput, ActionError> {
  const idResult = validateCoworkerDisplayActionId(input.id);
  if (idResult.isErr()) {
    return err(idResult.error);
  }

  const imageIntentResult = validateCoworkerDisplayImageIntent(
    input.imageIntent ?? "none",
  );
  if (imageIntentResult.isErr()) {
    return err(imageIntentResult.error);
  }

  const imageIntent = imageIntentResult.value;
  const imageFileResult = validateCoworkerDisplayImageFile(
    input.imageFile,
    imageIntent,
  );
  if (imageFileResult.isErr()) {
    return err(imageFileResult.error);
  }

  const sanitizeResult = sanitizeCoworkerDisplayPatchBody(input.patchBody);
  if (sanitizeResult.isErr()) {
    return err(sanitizeResult.error);
  }

  const safePatchBody = sanitizeResult.value;
  const hasPatchBody = Boolean(safePatchBody);
  if (!hasPatchBody && imageIntent === "none") {
    return err({
      code: CommonErrorCode.BAD_INPUT,
      message: "No coworker changes to save",
    });
  }

  return ok({
    id: idResult.value,
    patchBody: safePatchBody,
    imageIntent,
    imageFile: imageFileResult.value,
  });
}
