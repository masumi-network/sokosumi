import { InputSchemaType } from "@sokosumi/masumi/schemas";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Converts a plain object to InputSchemaType (Map), or returns null for invalid input.
 *
 * @param input - Plain object to convert to InputSchemaType Map
 * @returns InputSchemaType Map if conversion succeeds, null otherwise
 */
export function toInputSchema(input: unknown): InputSchemaType | null {
  if (!input || typeof input !== "object") return null;
  return new Map(
    Object.entries(input as Record<string, unknown>),
  ) as unknown as InputSchemaType;
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
