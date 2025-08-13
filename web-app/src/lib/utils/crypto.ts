import { randomBytes } from "crypto";

export function generateRandomHexString(length: number = 32): string {
  return randomBytes(length).toString("hex");
}
