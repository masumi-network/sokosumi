import { z } from "zod";

import { getEnvPublicConfig } from "@/config/env.public";

export const nameSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z
    .string({ error: t?.("Name.invalid") })
    .min(1, { error: t?.("Name.required") })
    .min(2, { error: t?.("Name.min") })
    .max(128, {
      error: t?.("Name.max"),
    });

export const emailSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z
    .email({ error: t?.("Email.invalid") })
    .min(1, { error: t?.("Email.required") });

export const passwordSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z
    .string({ error: t?.("Password.invalid") })
    .min(1, { error: t?.("Password.required") })
    .min(getEnvPublicConfig().NEXT_PUBLIC_PASSWORD_MIN_LENGTH, {
      error: t?.("Password.min"),
    })
    .max(getEnvPublicConfig().NEXT_PUBLIC_PASSWORD_MAX_LENGTH, {
      error: t?.("Password.max"),
    })
    .refine((value) => /^(?=.*[a-z])/.test(value), {
      error: t?.("Password.lowercase"),
    })
    .refine((value) => /^(?=.*[A-Z])/.test(value), {
      error: t?.("Password.uppercase"),
    })
    .refine((value) => /^(?=.*\d)/.test(value), {
      error: t?.("Password.number"),
    });

export const createOrganizationSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z.object({
    name: z
      .string()
      .min(2, { error: t?.("Organization.min") })
      .max(50, { error: t?.("Organization.max") }),
  });

export const confirmPasswordSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z
    .string({ error: t?.("ConfirmPassword.invalid") })
    .min(1, { error: t?.("ConfirmPassword.required") });

export const currentPasswordSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z
    .string({ error: t?.("CurrentPassword.invalid") })
    .min(1, { error: t?.("CurrentPassword.required") });

export const inputPasswordSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z
    .string({ error: t?.("InputPassword.invalid") })
    .min(1, { error: t?.("InputPassword.required") });
