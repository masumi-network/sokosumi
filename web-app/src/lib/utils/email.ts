import { z } from "zod";

export function isValidEmail(email: string): boolean {
  const emailSchema = z.string().email();
  const result = emailSchema.safeParse(email);
  return result.success;
}

export function getEmailDomain(email: string): string | null {
  const emailSchema = z.string().email();
  const result = emailSchema.safeParse(email);
  if (!result.success) {
    return null;
  }
  return result.data.split("@")[1].toLowerCase();
}
