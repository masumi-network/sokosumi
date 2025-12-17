import { hashInput, hashInputDeprecated, hashResult } from "./hash.js";

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
 * Verifies whether a given input hash matches the computed hash for the provided input data.
 *
 * Checks if the provided input hash matches either the current or deprecated input hash format
 * for backward compatibility.
 *
 * @param options - An object containing input data, input hash, and identifier.
 * @returns True if the provided hash matches the computed hash, false otherwise.
 */
export function isInputHashVerified(
  options: InputVerificationOptions,
): boolean {
  return verifyHashMatch(
    "input",
    options.inputHash,
    options.input,
    options.identifierFromPurchaser,
  );
}

/**
 * Verifies whether a given result hash matches the computed hash for the provided result data.
 *
 * @param options - An object containing result data, result hash, and identifier.
 * @returns True if the provided hash matches the computed hash, false otherwise.
 */
export function isResultHashVerified(
  options: ResultVerificationOptions,
): boolean {
  return verifyHashMatch(
    "result",
    options.resultHash,
    options.result,
    options.identifierFromPurchaser,
  );
}

/**
 * Compares a provided hash with the computed hash for input or result data.
 *
 * This utility supports verification of both input and result hashes.
 * For input hashes, also attempts a deprecated hash function for backward compatibility.
 *
 * @param mode - Either "input" or "result", determines which hash function is used
 * @param hash - The hash value to verify
 * @param data - The raw input/result data (JSON string for input, string for result)
 * @param identifierFromPurchaser - Unique identifier from the purchaser, used in the hash computation
 * @returns True if the provided hash matches the computed hash (including deprecated formats if applicable), false otherwise
 */
function verifyHashMatch(
  mode: "input" | "result",
  hash: string | null,
  data: string | null,
  identifierFromPurchaser: string,
): boolean {
  if (!hash || !data) return false;
  return isHashMatching(mode, identifierFromPurchaser, data, hash);
}

/**
 * Returns the matching hash (input or result) supporting deprecated input hash.
 *
 * For input verification:
 * - First attempts to match using the current hash format (hashInput)
 * - Falls back to deprecated hash format (hashInputDeprecated) for backward compatibility
 *
 * For result verification:
 * - Uses hashResult only (no deprecated format)
 *
 * @param mode - "input" or "result" to determine which hash function to use
 * @param identifierFromPurchaser - Unique identifier from the purchaser used in hash computation
 * @param data - JSON string for input mode, string for result mode
 * @param hashToMatch - The hash value to verify against
 * @returns The matched hash string if verification succeeds, null if no match found
 */
function isHashMatching(
  mode: "input" | "result",
  identifierFromPurchaser: string,
  data: string,
  hashToMatch?: string | null,
): boolean {
  if (!hashToMatch) return false;
  switch (mode) {
    case "input":
      const inputHash = hashInput(data, identifierFromPurchaser);
      if (hashToMatch === inputHash) return true;
      const deprecated = hashInputDeprecated(data, identifierFromPurchaser);
      if (hashToMatch === deprecated) return true;
      return false;
    case "result":
      const resultHash = hashResult(data, identifierFromPurchaser);
      return hashToMatch === resultHash;
  }
}
