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
      message: `The studio does not offer one of these settings: ${fieldRule(issue)}`,
    };
  }

  // A client mistake rather than something the person typed: a malformed id, a
  // missing idempotency key, a presenter shape an agent guessed. Name the field
  // and what to send, so the caller can fix it (SOKD-481).
  return {
    kind: IMAGE_STUDIO_REQUEST_ERROR_KINDS.invalidRequest,
    message: `The studio could not read this request: ${fieldRule(issue)}`,
  };
}

function quoted(values: readonly unknown[]): string {
  const words = values.map((value) =>
    typeof value === "string" ? `"${value}"` : String(value),
  );
  return words.length > 1
    ? `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`
    : (words[0] ?? "");
}

/**
 * "presenter.kind must be \"stock\" or \"file\"." In plain words, not Zod's:
 * the field as sent, and what it has to be.
 */
function fieldRule(issue: z.core.$ZodIssue): string {
  const field = issue.path.map(String).join(".") || "the body";
  switch (issue.code) {
    case "invalid_union":
      if ("options" in issue && Array.isArray(issue.options))
        return `${field} must be ${quoted(issue.options)}.`;
      break;
    case "invalid_value":
      return `${field} must be ${quoted(issue.values)}.`;
    case "invalid_type": {
      // Zod leaves `input` off its issues; its message is what says "missing".
      if (issue.message.endsWith("received undefined"))
        return `${field} is required.`;
      const type = issue.expected === "array" ? "list" : issue.expected;
      return `${field} must be ${/^[aeiou]/.test(type) ? "an" : "a"} ${type}.`;
    }
    case "invalid_format":
      return `${field} must be a ${issue.format === "uuid" ? "UUID" : `valid ${issue.format}`}.`;
    case "too_small":
    case "too_big": {
      const exclusive = issue.inclusive === false;
      const bound =
        issue.code === "too_small"
          ? exclusive
            ? "more than"
            : "at least"
          : exclusive
            ? "less than"
            : "at most";
      const limit = issue.code === "too_small" ? issue.minimum : issue.maximum;
      const unit =
        issue.origin === "string"
          ? " characters"
          : issue.origin === "array"
            ? " items"
            : "";
      return `${field} must be ${bound} ${String(limit)}${unit}.`;
    }
  }
  return `${field} is not valid.`;
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
