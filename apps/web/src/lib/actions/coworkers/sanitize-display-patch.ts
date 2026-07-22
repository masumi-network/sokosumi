import { err, ok, type Result } from "neverthrow";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import {
  COWORKER_CAPTION_MAX_LENGTH,
  COWORKER_NAME_MIN_LENGTH,
} from "@/lib/constants/coworker-display";
import type { CoworkerDisplayPatchBody } from "@/lib/services/coworker-display.service";

/** Client payload may include non-display keys; they are dropped. */
export interface UntrustedCoworkerDisplayPatch {
  name?: string;
  caption?: string | null;
  description?: string | null;
  image?: string | null;
}

export function sanitizeCoworkerDisplayPatchBody(
  patchBody: UntrustedCoworkerDisplayPatch | undefined,
): Result<CoworkerDisplayPatchBody | undefined, ActionError> {
  if (!patchBody) {
    return ok(undefined);
  }

  const sanitized: CoworkerDisplayPatchBody = {};

  if (patchBody.name !== undefined) {
    const name = patchBody.name.trim();
    if (name.length < COWORKER_NAME_MIN_LENGTH) {
      return err({
        code: CommonErrorCode.BAD_INPUT,
        message: `Name must be at least ${COWORKER_NAME_MIN_LENGTH} characters`,
      });
    }
    sanitized.name = name;
  }

  if (patchBody.caption !== undefined) {
    if (patchBody.caption === null) {
      sanitized.caption = null;
    } else {
      const caption = patchBody.caption.trim();
      if (caption.length === 0) {
        sanitized.caption = null;
      } else if (caption.length > COWORKER_CAPTION_MAX_LENGTH) {
        return err({
          code: CommonErrorCode.BAD_INPUT,
          message: `Caption must be at most ${COWORKER_CAPTION_MAX_LENGTH} characters`,
        });
      } else {
        sanitized.caption = caption;
      }
    }
  }

  if (patchBody.description !== undefined) {
    if (patchBody.description === null) {
      sanitized.description = null;
    } else {
      const description = patchBody.description.trim();
      sanitized.description = description.length > 0 ? description : null;
    }
  }

  return ok(Object.keys(sanitized).length > 0 ? sanitized : undefined);
}
