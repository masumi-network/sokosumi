import { z } from "zod";

import {
  confirmPasswordSchema,
  currentPasswordSchema,
  emailSchema,
  nameSchema,
  passwordSchema,
} from "@/lib/better-auth/data";

export const nameFormSchema = (t?: IntlTranslation<"Auth.Schema">) =>
  z.object({
    name: nameSchema(t),
  });

export const emailFormSchema = (t?: IntlTranslation<"Auth.Schema">) =>
  z.object({
    email: emailSchema(t),
  });

export const passwordFormSchema = (t?: IntlTranslation<"Auth.Schema">) =>
  z
    .object({
      currentPassword: currentPasswordSchema(t),
      newPassword: passwordSchema(t),
      confirmNewPassword: confirmPasswordSchema(t),
    })
    .refine((data) => data.newPassword === data.confirmNewPassword, {
      path: ["confirmNewPassword"],
      message: t?.("ConfirmPassword.match"),
    });

export const deleteAccountSchema = (t?: IntlTranslation<"Auth.Schema">) =>
  z.object({
    currentPassword: currentPasswordSchema(t),
  });

export type NameFormType = z.infer<ReturnType<typeof nameFormSchema>>;
export type EmailFormType = z.infer<ReturnType<typeof emailFormSchema>>;
export type PasswordFormType = z.infer<ReturnType<typeof passwordFormSchema>>;
export type DeleteAccountFormType = z.infer<
  ReturnType<typeof deleteAccountSchema>
>;
