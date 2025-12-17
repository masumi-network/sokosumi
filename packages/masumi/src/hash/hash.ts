import crypto from "crypto";
import { canonicalizeEx } from "json-canonicalize";

/**
 * Creates a SHA-256 hash of the input string.
 *
 * @param input - The input string to hash
 * @returns SHA-256 hash of the input string
 */
const createHash = (input: string) => {
  return crypto.createHash("sha256").update(input, "utf-8").digest("hex");
};

const _hashInput = (
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
 * @deprecated Use hashInput instead.
 * @param input - The job input data as a JSON string
 * @param identifierFromPurchaser - Unique identifier from the purchaser
 * @returns SHA-256 hash of the combined data, or null if parsing fails
 */
export const hashInputDeprecated = (
  input: string,
  identifierFromPurchaser: string,
) => {
  return _hashInput(input, identifierFromPurchaser, "");
};

/**
 * Calculates a hash for job input data combined with a purchaser identifier.
 *
 * @param input - The job input data as a JSON string
 * @param identifierFromPurchaser - Unique identifier from the purchaser
 * @returns SHA-256 hash of the combined data, or null if parsing fails
 */
export const hashInput = (input: string, identifierFromPurchaser: string) => {
  return _hashInput(input, identifierFromPurchaser, ";");
};

/**
 * Calculates a hash for job result combined with a purchaser identifier.
 *
 * @param result - The job result as a string
 * @param identifierFromPurchaser - Unique identifier from the purchaser
 * @returns SHA-256 hash of the combined data
 */
export const hashResult = (result: string, identifierFromPurchaser: string) => {
  // JSON.stringify escapes \n, \r, \t, backslashes, quotes, etc.
  // Slicing to remove the quotes
  const escaped = JSON.stringify(result).slice(1, -1);
  return createHash(identifierFromPurchaser + ";" + escaped);
};
