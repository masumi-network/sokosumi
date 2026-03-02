import crypto from "crypto";
import { canonicalizeEx } from "json-canonicalize";

import {
  type InputSchemaSchemaType,
  normalizeAndValidateInputSchema,
} from "../schemas/input/input.schema.js";

/**
 * Creates a SHA-256 hash of the input string.
 *
 * @param input - The input string to hash
 * @returns SHA-256 hash of the input string
 */
const createHash = (input: string) => {
  return crypto.createHash("sha256").update(input, "utf-8").digest("hex");
};

/**
 * Calculates a canonical SHA-256 hash for any JSON-serializable value.
 *
 * @param value - Parsed JSON value to canonicalize and hash
 * @returns SHA-256 hash of canonicalized JSON, or null when canonicalization fails
 */
export const hashCanonicalJsonValue = (value: unknown): string | null => {
  try {
    const canonicalValue = canonicalizeEx(value, {
      filterUndefined: true,
    });
    return createHash(canonicalValue);
  } catch {
    return null;
  }
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
 * Value to hash for provide_input's input_schema_hash. Accepts wrapped
 * (`{ input_data }` / `{ input_groups }`) and legacy bare-array schemas.
 * Hashes only the logical inner array so equivalent forms produce the same hash.
 *
 * @param inputSchema - Input schema JSON string
 * @returns SHA-256 hash of the logical input schema, or null if input is invalid
 */
export const hashInputSchema = (
  inputSchema: string | null | undefined,
): string | null => {
  if (!inputSchema) {
    return null;
  }

  try {
    const object = JSON.parse(inputSchema);
    const data = normalizeAndValidateInputSchema(object);
    if (!data) {
      return null;
    }
    const inner = "input_data" in data ? data.input_data : data.input_groups;
    return hashCanonicalJsonValue(inner);
  } catch {
    return null;
  }
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

/**
 * Builds an input schema snapshot in bare-array form.
 *
 * @param inputSchema - Canonical input schema payload
 * @returns Serialized bare array
 */
export function buildInputSchemaSnapshot(
  inputSchema: InputSchemaSchemaType,
): string {
  const innerSchema =
    "input_data" in inputSchema ? inputSchema.input_data : inputSchema.input_groups;
  return JSON.stringify(innerSchema);
}
