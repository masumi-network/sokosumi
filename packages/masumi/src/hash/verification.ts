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
 * Checks if the provided input hash matches either the current or deprecated input hash format
 * for backward compatibility.
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

function verifyHashMatch(
  mode: "input" | "result",
  hash: string | null,
  data: string | null,
  identifierFromPurchaser: string,
): boolean {
  if (!hash || !data) return false;
  return isHashMatching(mode, identifierFromPurchaser, data, hash);
}

function isHashMatching(
  mode: "input" | "result",
  identifierFromPurchaser: string,
  data: string,
  hashToMatch?: string | null,
): boolean {
  if (!hashToMatch) return false;
  switch (mode) {
    case "input": {
      const inputHash = hashInput(data, identifierFromPurchaser);
      if (hashToMatch === inputHash) return true;
      const deprecated = hashInputDeprecated(data, identifierFromPurchaser);
      if (hashToMatch === deprecated) return true;
      return false;
    }
    case "result": {
      const resultHash = hashResult(data, identifierFromPurchaser);
      return hashToMatch === resultHash;
    }
  }
}
