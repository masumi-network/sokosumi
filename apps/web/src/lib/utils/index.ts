import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import { JobInputData } from "@/lib/job-input";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Converts a plain object to JobInputData (Map), or returns null for invalid input.
 *
 * @param input - Plain object to convert to JobInputData Map
 * @returns JobInputData Map if conversion succeeds, null otherwise
 */
export function toJobInputData(input: unknown): JobInputData | null {
  if (!input || typeof input !== "object") return null;
  return new Map(
    Object.entries(input as Record<string, unknown>),
  ) as unknown as JobInputData;
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

export * from "./datetime";
export * from "./duration";
export * from "./email";
export * from "./gradient";
export * from "./parse-date";
export * from "./usdm-unit";
export * from "./user-agent";
