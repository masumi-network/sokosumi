import * as z from "zod";

export const PROJECT_IDENTIFIER_MAX_LENGTH = 7;

/** Same rule as Core: 2-7 uppercase letters or digits, starting with a letter. */
export const projectIdentifierSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{1,6}$/, "Invalid project identifier");

/** Uppercases and drops everything Core would reject, for as-you-type input. */
export function sanitizeProjectIdentifier(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, PROJECT_IDENTIFIER_MAX_LENGTH);
}

export function isValidProjectIdentifier(value: string): boolean {
  return projectIdentifierSchema.safeParse(value).success;
}
