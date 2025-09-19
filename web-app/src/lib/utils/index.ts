import { type ClassValue, clsx } from "clsx";
import crypto from "crypto";
import { canonicalizeEx } from "json-canonicalize";
import { twMerge } from "tailwind-merge";

import { JobInputData } from "@/lib/job-input";
import { JobStatusResponseSchemaType } from "@/lib/schemas";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const calculateInputHash = (
  inputData: JobInputData,
  identifierFromPurchaser: string,
  delimiter: string = ";",
) => {
  try {
    const object = Object.fromEntries(inputData);
    const inputString = canonicalizeEx(object, {
      filterUndefined: true,
    });
    return createHash(identifierFromPurchaser + delimiter + inputString);
  } catch (error) {
    console.log("error", error);
    throw error; // Re-throw the error to handle it properly
  }
};

/**
 * Calculates a hash for job input data combined with a purchaser identifier.
 *
 * @deprecated Use getInputHash instead.
 * @param inputData - The job input data as key-value pairs
 * @param identifierFromPurchaser - Unique identifier from the purchaser
 * @returns SHA-256 hash of the combined data
 */
export const getInputHashDeprecated = (
  inputData: JobInputData,
  identifierFromPurchaser: string,
) => {
  return calculateInputHash(inputData, identifierFromPurchaser, "");
};

/**
 * Calculates a hash for job input data combined with a purchaser identifier.
 *
 * @param inputData - The job input data as key-value pairs
 * @param identifierFromPurchaser - Unique identifier from the purchaser
 * @returns SHA-256 hash of the combined data
 */
export const getInputHash = (
  inputData: JobInputData,
  identifierFromPurchaser: string,
) => {
  return calculateInputHash(inputData, identifierFromPurchaser, ";");
};

/**
 * Calculates a hash for job output data combined with a purchaser identifier.
 *
 * @param outputData - The job output data as key-value pairs
 * @param identifierFromPurchaser - Unique identifier from the purchaser
 * @returns SHA-256 hash of the combined data
 */
export const getOutputHash = (
  outputData: JobStatusResponseSchemaType,
  identifierFromPurchaser: string,
) => {
  const outputString = canonicalizeEx(outputData, {
    filterUndefined: true,
  });
  return createHash(identifierFromPurchaser + ";" + outputString);
};

/**
 * Returns the matching hash (input or output) supporting deprecated input hash.
 *
 * For input verification:
 * - First attempts to match using the current hash format (getInputHash)
 * - Falls back to deprecated hash format (getInputHashDeprecated) for backward compatibility
 *
 * For output verification:
 * - Uses getOutputHash only (no deprecated format)
 *
 * @param mode - "input" or "output" to determine which hash function to use
 * @param data - JobInputData for input mode, JobStatusResponseSchemaType for output mode
 * @param identifierFromPurchaser - Unique identifier from the purchaser used in hash computation
 * @param hashToMatch - The hash value to verify against
 * @returns The matched hash string if verification succeeds, null if no match found
 */
export function getMatchedHash(
  mode: "input" | "output",
  data: JobInputData | JobStatusResponseSchemaType,
  identifierFromPurchaser: string,
  hashToMatch: string,
): string | null {
  if (mode === "input") {
    const inputHash = getInputHash(
      data as JobInputData,
      identifierFromPurchaser,
    );
    if (hashToMatch === inputHash) return inputHash;
    const deprecated = getInputHashDeprecated(
      data as JobInputData,
      identifierFromPurchaser,
    );
    if (hashToMatch === deprecated) return deprecated;
    return null;
  }
  // output
  const outputHash = getOutputHash(
    data as JobStatusResponseSchemaType,
    identifierFromPurchaser,
  );
  return hashToMatch === outputHash ? outputHash : null;
}

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

/**
 * Creates a SHA-256 hash of the input string.
 *
 * @param input - The input string to hash
 * @returns SHA-256 hash of the input string
 */
export const createHash = (input: string) => {
  return crypto.createHash("sha256").update(input).digest("hex");
};

export * from "./crypto";
export * from "./duration";
export * from "./email";
export * from "./parse-date";
export * from "./usdm-unit";
export * from "./user-agent";
