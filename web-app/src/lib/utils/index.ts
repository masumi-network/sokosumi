import { type ClassValue, clsx } from "clsx";
import crypto from "crypto";
import { canonicalizeEx } from "json-canonicalize";
import { twMerge } from "tailwind-merge";

import type { JobWithStatus } from "@/lib/db";
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
export const getResultHash = (
  outputData: JobStatusResponseSchemaType,
  identifierFromPurchaser: string,
) => {
  const outputValue = outputData.result;
  if (typeof outputValue !== "string") {
    return null;
  }

  // JSON.stringify escapes \n, \r, \t, backslashes, quotes, etc.
  // Slicing to remove the quotes
  const escaped = JSON.stringify(outputValue).slice(1, -1);

  return createHash(identifierFromPurchaser + ";" + escaped);
};

/**
 * Returns the matching hash (input or output) supporting deprecated input hash.
 *
 * For input verification:
 * - First attempts to match using the current hash format (getInputHash)
 * - Falls back to deprecated hash format (getInputHashDeprecated) for backward compatibility
 *
 * For output verification:
 * - Uses getResultHash only (no deprecated format)
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
  } else {
    // result hash
    const resultHash = getResultHash(
      data as JobStatusResponseSchemaType,
      identifierFromPurchaser,
    );
    return hashToMatch === resultHash ? resultHash : null;
  }
}

/**
 * Verifies whether a job's stored input or output hash matches the hash
 * computed from the provided purchaser identifier and parsed job data.
 *
 * Behavior:
 * - For "input": tries current hash format, then falls back to deprecated format
 *   for backward compatibility. Returns true if either matches.
 * - For "output": uses only the current output hash format.
 * - Returns false if required fields are missing or JSON cannot be parsed.
 *
 * @param direction - Which side of the job to verify: "input" or "output"
 * @param job - Job record including `input`, `output`, `inputHash`, `resultHash`
 * @param identifier - Purchaser-provided identifier used in hash computation
 * @returns true if the computed hash matches the stored hash; otherwise false
 */
export function isJobVerified(
  direction: "input" | "output",
  job: JobWithStatus,
): boolean {
  if (direction === "input") {
    if (!job.inputHash) return false;
    const inputObj = tryParseJson<Record<string, unknown>>(job.input);
    const inputData = inputObj ? toJobInputData(inputObj) : null;
    if (!inputData) return false;
    const matched = getMatchedHash(
      "input",
      inputData,
      job.identifierFromPurchaser,
      job.inputHash,
    );
    return matched !== null;
  }
  if (!job.resultHash) return false;
  const outputObj = tryParseJson<JobStatusResponseSchemaType>(job.output);
  if (!outputObj) return false;
  const matched = getMatchedHash(
    "output",
    outputObj,
    job.identifierFromPurchaser,
    job.resultHash,
  );
  return matched !== null;
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
  return crypto.createHash("sha256").update(input, "utf-8").digest("hex");
};

export * from "./crypto";
export * from "./datetime";
export * from "./duration";
export * from "./email";
export * from "./parse-date";
export * from "./usdm-unit";
export * from "./user-agent";
