import { z } from "zod";

import { envConfig } from "@/config/env.config";

export const passwordSchema = z
  .string({
    invalid_type_error: "Password must be a string",
    required_error: "Password is required",
  })
  .min(envConfig.PASSWORD_MIN_LENGTH)
  .max(envConfig.PASSWORD_MAX_LENGTH)
  .refine((value) => /^(?=.*[a-z])/.test(value), {
    params: {
      lowercase: true,
    },
  })
  .refine((value) => /^(?=.*[A-Z])/.test(value), {
    params: {
      uppercase: true,
    },
  })
  .refine((value) => /^(?=.*\d)/.test(value), {
    params: {
      number: true,
    },
  });
export const confirmPasswordSchema = z.string().nonempty();

export const nameSchema = z.string().min(2).max(128);

export const emailSchema = z.string().email();

export const currentPasswordSchema = z.string().nonempty();
