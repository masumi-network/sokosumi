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
function findMatchingHash(
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
 * @returns True if the provided hash matches the computed hash, false otherwise.
 */
export function isHashVerified(
  mode: "input" | "result",
  options: InputVerificationOptions | ResultVerificationOptions,
): boolean {
  if (mode === "input") {
    const inputOptions = options as InputVerificationOptions;
    return verifyHashMatch(
      "input",
      inputOptions.inputHash,
      inputOptions.input,
      inputOptions.identifierFromPurchaser,
    );
  }

  if (mode === "result") {
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
  mode: "input" | "result",
  hash: string | null,
  data: string | null,
  identifierFromPurchaser: string,
) {
  if (!hash || !data) return false;
  const matchedHash = findMatchingHash(
    mode,
    identifierFromPurchaser,
    data,
    hash,
  );
  return matchedHash !== null;
}
