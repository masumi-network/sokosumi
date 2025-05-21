import { z } from "zod";

import { getEnvPublicConfig } from "@/config/env.config";

export const nameSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z
    .string({ message: t?.("Name.invalid") })
    .min(1, { message: t?.("Name.required") })
    .min(2, { message: t?.("Name.min") })
    .max(128, {
      message: t?.("Name.max"),
    });

export const emailSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z
    .string({ message: t?.("Email.invalid") })
    .min(1, { message: t?.("Email.required") })
    .email({ message: t?.("Email.invalid") });

export const passwordSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z
    .string({ message: t?.("Password.invalid") })
    .min(1, { message: t?.("Password.required") })
    .min(getEnvPublicConfig().NEXT_PUBLIC_PASSWORD_MIN_LENGTH, {
      message: t?.("Password.min"),
    })
    .max(getEnvPublicConfig().NEXT_PUBLIC_PASSWORD_MAX_LENGTH, {
      message: t?.("Password.max"),
    })
    .refine((value) => /^(?=.*[a-z])/.test(value), {
      message: t?.("Password.lowercase"),
    })
    .refine((value) => /^(?=.*[A-Z])/.test(value), {
      message: t?.("Password.uppercase"),
    })
    .refine((value) => /^(?=.*\d)/.test(value), {
      message: t?.("Password.number"),
    });

export const organizationIdSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z
    .string({ message: t?.("Organization.invalid") })
    .min(1, { message: t?.("Organization.required") });

export const confirmPasswordSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z
    .string({ message: t?.("ConfirmPassword.invalid") })
    .min(1, { message: t?.("ConfirmPassword.required") });

export const currentPasswordSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z
    .string({ message: t?.("CurrentPassword.invalid") })
    .min(1, { message: t?.("CurrentPassword.required") });

export const inputPasswordSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z
    .string({ message: t?.("InputPassword.invalid") })
    .min(1, { message: t?.("InputPassword.required") });
