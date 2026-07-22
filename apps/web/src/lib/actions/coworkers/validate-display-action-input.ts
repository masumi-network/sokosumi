import { err, ok, type Result } from "neverthrow";
import * as z from "zod";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { COWORKER_IMAGE_ALLOWED_MIME_TYPES } from "@/lib/constants/coworker-image";
import type { CoworkerImageIntent } from "@/lib/services/coworker-display.service";

const coworkerIdSchema = z.string().trim().min(1);

const imageIntentSchema = z.enum(["none", "upload", "remove"]);

const untrustedPatchFieldsSchema = z.object({
  name: z.string().optional(),
  caption: z.union([z.string(), z.null()]).optional(),
  description: z.union([z.string(), z.null()]).optional(),
  image: z.union([z.string(), z.null()]).optional(),
});

function badInput(message: string): ActionError {
  return {
    code: CommonErrorCode.BAD_INPUT,
    message,
  };
}

export function validateCoworkerDisplayActionId(
  id: unknown,
): Result<string, ActionError> {
  const parsed = coworkerIdSchema.safeParse(id);
  if (!parsed.success) {
    return err(badInput("Invalid coworker id"));
  }

  return ok(parsed.data);
}

export function validateCoworkerDisplayImageIntent(
  imageIntent: unknown,
): Result<CoworkerImageIntent, ActionError> {
  const parsed = imageIntentSchema.safeParse(imageIntent);
  if (!parsed.success) {
    return err(badInput("Invalid image intent"));
  }

  return ok(parsed.data);
}

export function validateCoworkerDisplayImageFile(
  imageFile: unknown,
  imageIntent: CoworkerImageIntent,
): Result<File | Blob | undefined, ActionError> {
  if (imageIntent === "upload") {
    if (!(imageFile instanceof File) && !(imageFile instanceof Blob)) {
      return err(badInput("Image file is required for upload"));
    }

    const mimeType = imageFile.type;
    const allowedMimeTypes: readonly string[] =
      COWORKER_IMAGE_ALLOWED_MIME_TYPES;
    if (!allowedMimeTypes.includes(mimeType)) {
      return err(badInput("Invalid image file type"));
    }

    return ok(imageFile);
  }

  if (imageFile !== undefined && imageFile !== null) {
    return err(badInput("Image file is only allowed for upload"));
  }

  return ok(undefined);
}

export function parseUntrustedCoworkerDisplayPatchFields(
  patchBody: unknown,
): Result<
  | {
      name?: string;
      caption?: string | null;
      description?: string | null;
    }
  | undefined,
  ActionError
> {
  if (patchBody === undefined) {
    return ok(undefined);
  }

  const parsed = untrustedPatchFieldsSchema.safeParse(patchBody);
  if (!parsed.success) {
    return err(badInput("Invalid coworker display fields"));
  }

  const { image: _image, ...displayFields } = parsed.data;
  const hasFields = Object.keys(displayFields).length > 0;

  return ok(hasFields ? displayFields : undefined);
}
