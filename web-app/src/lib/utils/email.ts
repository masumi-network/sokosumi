import { z } from "zod";

export function isValidEmail(email: string): boolean {
  const emailSchema = z.string().email();
  const result = emailSchema.safeParse(email);
  return result.success;
}

export function getEmailDomain(email: string): string {
  const emailSchema = z.string().email();
  const result = emailSchema.safeParse(email);
  if (!result.success) {
    return "";
  }
  return result.data.split("@")[1];
}
