import type { InputSchemaType } from "@sokosumi/masumi/schemas";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Converts a plain object to `InputSchemaType`, or returns null for invalid input.
 *
 * Note: `InputSchemaType` is a plain object record type (not a Map).
 *
 * @param input - Plain object to convert
 * @returns InputSchemaType object if conversion succeeds, null otherwise
 */
export function toInputSchema(input: unknown): InputSchemaType | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return input as InputSchemaType;
}

/**
 * Safe JSON.parse returning null on failure.
 *
 * @param value - JSON string to parse
 * @returns Parsed object of type T if successful, null otherwise
 */
export function tryParseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Converts empty strings to null, preserving other values.
 * Useful for database operations where empty strings should be stored as null.
 *
 * @param value - String value to convert
 * @returns null if value is empty string, otherwise returns the value
 */
export function emptyStringToNull<T>(
  value: T,
): T extends string ? string | null : T {
  if (typeof value === "string" && value === "") {
    return null as T extends string ? string | null : T;
  }
  return value as T extends string ? string | null : T;
}

export * from "./datetime";
export * from "./duration";
export * from "./email";
export * from "./gradient";
export * from "./parse-date";
export * from "./usdm-unit";
export * from "./user-agent";
