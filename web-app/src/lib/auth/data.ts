import { z } from "zod";

import { getEnvPublicConfig } from "@/config/env.public";

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

export const selectedOrganizationSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z
    .object({
      id: z.string().nullish(),
      name: z.string().nullish(),
    })
    .superRefine((value, ctx) => {
      if (!value.id && !value.name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t?.("Organization.required"),
        });
      } else if (value.name && value.name.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          minimum: 2,
          type: "string",
          inclusive: true,
          message: t?.("Organization.min"),
        });
      } else if (value.name && value.name.length > 50) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          maximum: 50,
          type: "string",
          inclusive: true,
          message: t?.("Organization.max"),
        });
      }
    });

export const createOrganizationSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z.object({
    name: z
      .string()
      .min(2, { message: t?.("Organization.min") })
      .max(50, { message: t?.("Organization.max") }),
  });

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
