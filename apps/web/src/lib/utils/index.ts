import { hashInput, hashInputDeprecated, hashResult } from "@sokosumi/masumi";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import { JobInputData } from "@/lib/job-input";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
export function findingMatchingHash(
  mode: "input" | "result",
  identifierFromPurchaser: string,
  data: string,
  hashToMatch?: string | null,
): string | null {
  if (!hashToMatch) return null;
  if (mode === "input") {
    const inputHash = hashInput(data, identifierFromPurchaser);
    if (hashToMatch === inputHash) return inputHash;
    const deprecated = hashInputDeprecated(data, identifierFromPurchaser);
    if (hashToMatch === deprecated) return deprecated;
    return null;
  } else {
    // result hash
    const resultHash = hashResult(data, identifierFromPurchaser);
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
 * Verifies whether a given hash matches the computed hash for the provided input or result data.
 *
 * For input verification:
 * - Checks if the provided input hash matches either the current or deprecated input hash format.
 *
 * For result verification:
 * - Checks if the provided result hash matches the computed result hash.
 *
 * @param mode - Determines the verification type: "input" for input hash verification, "result" for result hash verification.
 * @param options - An object containing either input or result data and the associated hash and identifier.
 *   - For "input", expects {@link InputVerificationOptions}
 *   - For "result", expects {@link ResultVerificationOptions}
 * @returns {boolean} True if the provided hash matches the computed hash, false otherwise.
 */
export function isHashVerified(
  mode: "input" | "result",
  options: InputVerificationOptions | ResultVerificationOptions,
): boolean {
  if (mode === "input") {
    const inputOptions = options as InputVerificationOptions;
    return _isHashVerified(
      mode,
      inputOptions.inputHash,
      inputOptions.input,
      inputOptions.identifierFromPurchaser,
    );
  }

  if (mode === "result") {
    const resultOptions = options as ResultVerificationOptions;
    return _isHashVerified(
      mode,
      resultOptions.resultHash,
      resultOptions.result,
      resultOptions.identifierFromPurchaser,
    );
  }

  return false;
}

function _isHashVerified(
  mode: "input" | "result",
  hash: string | null,
  data: string | null,
  identifierFromPurchaser: string,
) {
  if (!hash || !data) return false;
  const matchedHash = findingMatchingHash(
    mode,
    identifierFromPurchaser,
    data,
    hash,
  );
  return matchedHash !== null;
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

export * from "./datetime";
export * from "./duration";
export * from "./email";
export * from "./gradient";
export * from "./parse-date";
export * from "./usdm-unit";
export * from "./user-agent";
