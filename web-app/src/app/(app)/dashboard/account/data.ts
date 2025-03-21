import { z } from "zod";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/constants";

export const nameFormSchema = z.object({
  name: z.string().min(2).max(128),
  currentPassword: z.string().min(1),
});

export const emailFormSchema = z.object({
  email: z.string().email(),
  currentPassword: z.string().min(1),
});

export const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH)
      .max(PASSWORD_MAX_LENGTH)
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
    confirmNewPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match",
    path: ["confirmNewPassword"],
  });

export const deleteAccountSchema = z.object({
  currentPassword: z.string().min(1),
});

export type NameFormType = z.infer<typeof nameFormSchema>;
export type EmailFormType = z.infer<typeof emailFormSchema>;
export type PasswordFormType = z.infer<typeof passwordFormSchema>;
export type DeleteAccountFormType = z.infer<typeof deleteAccountSchema>;
