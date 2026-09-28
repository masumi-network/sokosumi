import type { z } from "@hono/zod-openapi";

import { unprocessableEntity } from "@/helpers/error";

/**
 * What the studio says when it refuses a request, instead of what Zod says.
 *
 * A 26,520-character prompt was refused on preview with
 * `Key: prompt - Too big: expected string to have <=4000 characters`. Nothing was
 * charged, which is right, but that sentence is a validation library talking to
 * itself: it names an internal field path, it describes a constraint rather than
 * what to do, and it is English in a studio offered in three languages.
 *
 * This is the same treatment the provider's transport strings got. A stable `kind`
 * a client matches on and localises — the error envelope documents `kind` as the
 * thing to match instead of `message` — plus an English sentence as the fallback.
 *
 * Deliberately *not* a change to `formatZodErrorMessage`, which every route in
 * Core shares: rewording that would change the refusal text of the whole API to
 * fix one studio form. This is a per-route hook, and only the studio's routes use
 * it.
 */

/** Longest prompt the studio accepts. Quoted in the message, so they agree. */
export const IMAGE_PROMPT_MAX_LENGTH = 4_000;

export const IMAGE_STUDIO_REQUEST_ERROR_KINDS = {
  promptRequired: "image_prompt_required",
  promptTooLong: "image_prompt_too_long",
  unknownModel: "image_unknown_model",
  unsupportedSetting: "image_unsupported_setting",
  tooManyReferences: "image_too_many_references",
  invalidRequest: "image_invalid_request",
} as const;

export interface ImageStudioRequestRefusal {
  kind: string;
  message: string;
}

/** The field a Zod issue is about, as a dotted path without array indices. */
function fieldPath(issue: z.core.$ZodIssue): string {
  return issue.path.filter((segment) => typeof segment === "string").join(".");
}

/**
 * Turn the first validation issue into something a person can act on.
 *
 * First issue only, matching what the shared hook does: a form shows one problem
 * at a time, and the studio composer has three fields.
 */
export function describeImageStudioRefusal(
  error: z.ZodError,
): ImageStudioRequestRefusal {
  const issue = error.issues[0];
  if (!issue) {
    return {
      kind: IMAGE_STUDIO_REQUEST_ERROR_KINDS.invalidRequest,
      message: "The studio could not read this request.",
    };
  }

  const field = fieldPath(issue);

  if (field === "prompt") {
    if (issue.code === "too_big") {
      return {
        kind: IMAGE_STUDIO_REQUEST_ERROR_KINDS.promptTooLong,
        message: `This prompt is too long. Keep it under ${IMAGE_PROMPT_MAX_LENGTH.toLocaleString("en-US")} characters.`,
      };
    }
    return {
      kind: IMAGE_STUDIO_REQUEST_ERROR_KINDS.promptRequired,
      message: "Describe the image you want before generating.",
    };
  }

  if (field === "modelId") {
    return {
      kind: IMAGE_STUDIO_REQUEST_ERROR_KINDS.unknownModel,
      message: "That model is not in the studio catalog. Choose another one.",
    };
  }

  if (field === "referenceAssetIds") {
    return {
      kind: IMAGE_STUDIO_REQUEST_ERROR_KINDS.tooManyReferences,
      message: "Too many reference images for one generation.",
    };
  }

  if (field.startsWith("settings.")) {
    return {
      kind: IMAGE_STUDIO_REQUEST_ERROR_KINDS.unsupportedSetting,
      message: "The studio does not offer one of these settings.",
    };
  }

  // A client bug rather than something the person typed — a malformed asset id, a
  // missing idempotency key. Says so without naming the field, because the field
  // name is no use to whoever is reading it.
  return {
    kind: IMAGE_STUDIO_REQUEST_ERROR_KINDS.invalidRequest,
    message: "The studio could not read this request.",
  };
}

/**
 * The studio's validation hook, passed per route to `app.openapi`.
 *
 * Throws the same 422 the shared hook throws, with the studio's own wording and a
 * kind. Nothing is reserved, charged or sent — a refused request costs nothing,
 * which was already true and stays true.
 */
export function imageStudioValidationHook(result: {
  success: boolean;
  error?: z.ZodError;
}): undefined {
  // `undefined` and not `void`: a per-route hook may return a response instead of
  // throwing, so the slot is typed for one. This one always throws or passes.
  if (result.success) return undefined;
  const refusal = result.error
    ? describeImageStudioRefusal(result.error)
    : {
        kind: IMAGE_STUDIO_REQUEST_ERROR_KINDS.invalidRequest,
        message: "The studio could not read this request.",
      };
  throw unprocessableEntity(refusal.message, { kind: refusal.kind });
}
