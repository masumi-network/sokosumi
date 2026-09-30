import { z } from "zod";

/** Max length of a project task-id prefix (e.g. SOK in SOK-123). */
export const PROJECT_IDENTIFIER_MAX_LENGTH = 7;

const PROJECT_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9]{1,6}$/;

/** Shared by Core OpenAPI and the web project form: 2–7 chars, letter then alphanumerics. */
export const projectIdentifierSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    PROJECT_IDENTIFIER_PATTERN,
    "Identifier must be 2-7 letters or digits and start with a letter",
  );

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
