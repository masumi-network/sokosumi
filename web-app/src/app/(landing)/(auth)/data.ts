import { z } from "zod";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/constants";

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/);
export const confirmPasswordSchema = z.string();

export const nameSchema = z.string().min(2).max(128);

export const emailSchema = z.string().email();
