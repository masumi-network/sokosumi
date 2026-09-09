import * as z from "zod";

export function isValidEmail(email: string): boolean {
  const emailSchema = z.email();
  const result = emailSchema.safeParse(email);
  return result.success;
}
