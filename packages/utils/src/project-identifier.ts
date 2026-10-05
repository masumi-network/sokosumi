import { z } from "zod";

/** Max length of a project task-id prefix (e.g. SOK in SOK-123). */
export const PROJECT_IDENTIFIER_MAX_LENGTH = 7;

/** Shared shape: 2–7 uppercase letters/digits, starting with a letter. */
export const PROJECT_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9]{1,6}$/;

export const PROJECT_IDENTIFIER_ERROR =
  "Identifier must be 2-7 letters or digits and start with a letter";

/** Plain Zod schema for Web and shared validation. Core rebuilds with OpenAPI `z`. */
export const projectIdentifierSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PROJECT_IDENTIFIER_PATTERN, PROJECT_IDENTIFIER_ERROR);

/** Uppercases and drops everything the schema would reject, for as-you-type input. */
export function sanitizeProjectIdentifier(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, PROJECT_IDENTIFIER_MAX_LENGTH);
}

export function isValidProjectIdentifier(value: string): boolean {
  return projectIdentifierSchema.safeParse(value).success;
}
