import crypto from "node:crypto";
import { canonicalizeEx } from "json-canonicalize";

import { normalizeAndValidateInputSchema } from "../schemas/input/input.schema.js";

const createHash = (input: string) => {
  return crypto.createHash("sha256").update(input, "utf-8").digest("hex");
};

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
 * @deprecated Use hashInput instead.
 */
export const hashInputDeprecated = (
  input: string,
  identifierFromPurchaser: string,
) => {
  return _hashInput(input, identifierFromPurchaser, "");
};

export const hashInput = (input: string, identifierFromPurchaser: string) => {
  return _hashInput(input, identifierFromPurchaser, ";");
};

/**
 * Value to hash for provide_input's input_schema_hash. Accepts wrapped
 * (`{ input_data }` / `{ input_groups }`) and legacy bare-array schemas.
 * Hashes the full normalized schema object so persistence and hashing share
 * the same canonical representation.
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
    return hashCanonicalJsonValue(data);
  } catch {
    return null;
  }
};

export const hashResult = (result: string, identifierFromPurchaser: string) => {
  // JSON.stringify escapes \n, \r, \t, backslashes, quotes, etc.
  // Slicing to remove the quotes
  const escaped = JSON.stringify(result).slice(1, -1);
  return createHash(`${identifierFromPurchaser};${escaped}`);
};
