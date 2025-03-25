import { z } from "zod";

import {
  confirmPasswordSchema,
  currentPasswordSchema,
  emailSchema,
  nameSchema,
  passwordSchema,
} from "@/lib/better-auth/data";

export const nameFormSchema = z.object({
  name: nameSchema,
});

export const emailFormSchema = z.object({
  email: emailSchema,
});

export const passwordFormSchema = z
  .object({
    currentPassword: currentPasswordSchema,
    newPassword: passwordSchema,
    confirmNewPassword: confirmPasswordSchema,
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    path: ["confirmNewPassword"],
  });

export const deleteAccountSchema = z.object({
  currentPassword: currentPasswordSchema,
});

export type NameFormType = z.infer<typeof nameFormSchema>;
export type EmailFormType = z.infer<typeof emailFormSchema>;
export type PasswordFormType = z.infer<typeof passwordFormSchema>;
export type DeleteAccountFormType = z.infer<typeof deleteAccountSchema>;
