import { type ClassValue, clsx } from "clsx";
import crypto from "crypto";
import { canonicalizeEx } from "json-canonicalize";
import { twMerge } from "tailwind-merge";

import { JobInputData } from "@/lib/job-input";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const calculateInputHash = (
  input: string,
  identifierFromPurchaser: string,
  delimiter: string = ";",
) => {
  try {
    const object = JSON.parse(input);
    const inputString = canonicalizeEx(object, {
      filterUndefined: true,
    });
    return createHash(identifierFromPurchaser + delimiter + inputString);
  } catch {
    return null;
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
  input: string,
  identifierFromPurchaser: string,
) => {
  return calculateInputHash(input, identifierFromPurchaser, "");
};

/**
 * Calculates a hash for job input data combined with a purchaser identifier.
 *
 * @param inputData - The job input data as key-value pairs
 * @param identifierFromPurchaser - Unique identifier from the purchaser
 * @returns SHA-256 hash of the combined data
 */
export const getInputHash = (
  input: string,
  identifierFromPurchaser: string,
) => {
  return calculateInputHash(input, identifierFromPurchaser, ";");
};

/**
 * Calculates a hash for job result combined with a purchaser identifier.
 *
 * @param result - The job result as a string
 * @param identifierFromPurchaser - Unique identifier from the purchaser
 * @returns SHA-256 hash of the combined data
 */
export const getResultHash = (
  result: string,
  identifierFromPurchaser: string,
) => {
  // JSON.stringify escapes \n, \r, \t, backslashes, quotes, etc.
  // Slicing to remove the quotes
  try {
    const escaped = JSON.stringify(result).slice(1, -1);
    return createHash(identifierFromPurchaser + ";" + escaped);
  } catch {
    return null;
  }
};

/**
 * Returns the matching hash (input or result) supporting deprecated input hash.
 *
 * For input verification:
 * - First attempts to match using the current hash format (getInputHash)
 * - Falls back to deprecated hash format (getInputHashDeprecated) for backward compatibility
 *
 * For result verification:
 * - Uses getResultHash only (no deprecated format)
 *
 * @param mode - "input" or "result" to determine which hash function to use
 * @param data - JobInputData for input mode, string for result mode
 * @param identifierFromPurchaser - Unique identifier from the purchaser used in hash computation
 * @param hashToMatch - The hash value to verify against
 * @returns The matched hash string if verification succeeds, null if no match found
 */
export function getMatchedHash(
  mode: "input" | "result",
  identifierFromPurchaser: string,
  data: string,
  hashToMatch?: string | null,
): string | null {
  if (!hashToMatch) return null;
  if (mode === "input") {
    const inputHash = getInputHash(data, identifierFromPurchaser);
    if (hashToMatch === inputHash) return inputHash;
    const deprecated = getInputHashDeprecated(data, identifierFromPurchaser);
    if (hashToMatch === deprecated) return deprecated;
    return null;
  } else {
    // result hash
    const resultHash = getResultHash(data, identifierFromPurchaser);
    return hashToMatch === resultHash ? resultHash : null;
  }
}

export interface InputVerificationOptions {
  identifierFromPurchaser: string;
  inputHash: string | null;
  input: string | null;
}

export interface ResultVerificationOptions {
  identifierFromPurchaser: string;
  resultHash: string | null;
  result: string | null;
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
  direction: "input" | "result",
  options: InputVerificationOptions | ResultVerificationOptions,
): boolean {
  if (direction === "input") {
    const inputOptions = options as InputVerificationOptions;
    return verifyHashMatch(
      "input",
      inputOptions.inputHash,
      inputOptions.input,
      inputOptions.identifierFromPurchaser,
    );
  }

  if (direction === "result") {
    const resultOptions = options as ResultVerificationOptions;
    return verifyHashMatch(
      "result",
      resultOptions.resultHash,
      resultOptions.result,
      resultOptions.identifierFromPurchaser,
    );
  }

  return false;
}

function verifyHashMatch(
  direction: "input" | "result",
  hash: string | null,
  data: string | null,
  identifierFromPurchaser: string,
) {
  if (!hash || !data) return false;
  const matched = getMatchedHash(
    direction,
    identifierFromPurchaser,
    data,
    hash,
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

export * from "./datetime";
export * from "./duration";
export * from "./email";
export * from "./gradient";
export * from "./parse-date";
export * from "./usdm-unit";
export * from "./user-agent";
