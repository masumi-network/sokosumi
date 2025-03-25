import { z } from "zod";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/constants";

export const nameSchema = (t?: IntlTranslation<"Auth.Schema">) =>
  z
    .string({ message: t?.("Name.invalid") })
    .nonempty({ message: t?.("Name.required") })
    .min(2, { message: t?.("Name.min") })
    .max(128, {
      message: t?.("Name.max"),
    });

export const emailSchema = (t?: IntlTranslation<"Auth.Schema">) =>
  z
    .string({ message: t?.("Email.invalid") })
    .nonempty({ message: t?.("Email.required") })
    .email({ message: t?.("Email.invalid") });

export const passwordSchema = (t?: IntlTranslation<"Auth.Schema">) =>
  z
    .string({ message: t?.("Password.invalid") })
    .nonempty({ message: t?.("Password.required") })
    .min(PASSWORD_MIN_LENGTH, { message: t?.("Password.min") })
    .max(PASSWORD_MAX_LENGTH, { message: t?.("Password.max") })
    .refine((value) => /^(?=.*[a-z])/.test(value), {
      message: t?.("Password.lowercase"),
    })
    .refine((value) => /^(?=.*[A-Z])/.test(value), {
      message: t?.("Password.uppercase"),
    })
    .refine((value) => /^(?=.*\d)/.test(value), {
      message: t?.("Password.number"),
    });

export const confirmPasswordSchema = (t?: IntlTranslation<"Auth.Schema">) =>
  z
    .string({ message: t?.("ConfirmPassword.invalid") })
    .nonempty({ message: t?.("ConfirmPassword.required") });

export const currentPasswordSchema = (t?: IntlTranslation<"Auth.Schema">) =>
  z
    .string({ message: t?.("CurrentPassword.invalid") })
    .nonempty({ message: t?.("CurrentPassword.required") });

export const inputPasswordSchema = (t?: IntlTranslation<"Auth.Schema">) =>
  z
    .string({ message: t?.("InputPassword.invalid") })
    .nonempty({ message: t?.("InputPassword.required") });
