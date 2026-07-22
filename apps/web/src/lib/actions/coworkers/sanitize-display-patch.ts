import { err, ok, type Result } from "neverthrow";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import {
  COWORKER_CAPTION_MAX_LENGTH,
  COWORKER_NAME_MIN_LENGTH,
} from "@/lib/constants/coworker-display";
import type { CoworkerDisplayPatchBody } from "@/lib/services/coworker-display.service";

import { parseUntrustedCoworkerDisplayPatchFields } from "./validate-display-action-input";

export function sanitizeCoworkerDisplayPatchBody(
  patchBody: unknown,
): Result<CoworkerDisplayPatchBody | undefined, ActionError> {
  const parsedFields = parseUntrustedCoworkerDisplayPatchFields(patchBody);
  if (parsedFields.isErr()) {
    return err(parsedFields.error);
  }

  const fields = parsedFields.value;
  if (!fields) {
    return ok(undefined);
  }

  const sanitized: CoworkerDisplayPatchBody = {};

  if (fields.name !== undefined) {
    const name = fields.name.trim();
    if (name.length < COWORKER_NAME_MIN_LENGTH) {
      return err({
        code: CommonErrorCode.BAD_INPUT,
        message: `Name must be at least ${COWORKER_NAME_MIN_LENGTH} characters`,
      });
    }
    sanitized.name = name;
  }

  if (fields.caption !== undefined) {
    if (fields.caption === null) {
      sanitized.caption = null;
    } else {
      const caption = fields.caption.trim();
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

  if (fields.description !== undefined) {
    if (fields.description === null) {
      sanitized.description = null;
    } else {
      const description = fields.description.trim();
      sanitized.description = description.length > 0 ? description : null;
    }
  }

  return ok(Object.keys(sanitized).length > 0 ? sanitized : undefined);
}
