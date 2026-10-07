import {
  isFirstAndLastNameWithinLimit,
  USER_NAME_MAX_LENGTH,
} from "@sokosumi/utils";
import * as z from "zod";

import { getEnvPublicConfig } from "@/config/env.public";

export const nameSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z
    .string({ error: t?.("Name.invalid") })
    .min(1, { error: t?.("Name.required") })
    .min(2, { error: t?.("Name.min") })
    .max(USER_NAME_MAX_LENGTH, {
      error: t?.("Name.max"),
    });

const firstNameSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z
    .string({ error: t?.("FirstName.required") })
    .trim()
    .min(1, { error: t?.("FirstName.required") });

const lastNameSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z
    .string({ error: t?.("LastName.required") })
    .trim()
    .min(1, { error: t?.("LastName.required") });

export const firstAndLastNameSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z
    .object({
      firstName: firstNameSchema(t),
      lastName: lastNameSchema(t),
    })
    .refine(
      ({ firstName, lastName }) =>
        isFirstAndLastNameWithinLimit(firstName, lastName),
      {
        path: ["lastName"],
        error: t?.("FullName.max"),
      },
    );

export const emailSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z
    .string({ error: t?.("Email.invalid") })
    .trim()
    .min(1, { error: t?.("Email.required") })
    .pipe(z.email({ error: t?.("Email.invalid") }));

// Length only, matching what Core enforces.
export const passwordSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z
    .string({ error: t?.("Password.invalid") })
    .min(1, { error: t?.("Password.required") })
    .min(getEnvPublicConfig().NEXT_PUBLIC_PASSWORD_MIN_LENGTH, {
      error: t?.("Password.min"),
    })
    .max(getEnvPublicConfig().NEXT_PUBLIC_PASSWORD_MAX_LENGTH, {
      error: t?.("Password.max"),
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
