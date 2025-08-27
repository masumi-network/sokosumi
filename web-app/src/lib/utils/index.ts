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
