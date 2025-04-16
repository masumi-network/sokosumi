import json from "@tufjs/canonical-json";
import { type ClassValue, clsx } from "clsx";
import crypto from "crypto";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const calculatedInputHash = (
  inputData: Map<string, string | number | boolean | number[]>,
  identifierFromPurchaser: string,
) => {
  const inputString = json.canonicalize(Object.fromEntries(inputData));
  return createHash(identifierFromPurchaser + inputString);
};

export const createHash = (input: string) => {
  return crypto.createHash("sha256").update(input).digest("hex");
};
