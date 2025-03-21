import { z } from "zod";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/constants";

export const emailFormSchema = () =>
  z.object({
    email: z.string().email({
      message: "Please enter a valid email address.",
    }),
    currentPassword: z.string().min(1, "Current password is required"),
  });

export const passwordFormSchema = () =>
  z
    .object({
      currentPassword: z.string().min(1, "Current password is required"),
      newPassword: z
        .string()
        .min(
          PASSWORD_MIN_LENGTH,
          `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
        )
        .max(
          PASSWORD_MAX_LENGTH,
          `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
        )
        .regex(
          /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
          "Password must contain at least one uppercase letter, one lowercase letter, and one number",
        ),
      confirmNewPassword: z.string(),
    })
    .refine((data) => data.newPassword === data.confirmNewPassword, {
      message: "Passwords do not match",
      path: ["confirmNewPassword"],
    });

export const deleteAccountSchema = () =>
  z.object({
    currentPassword: z.string().min(1, "Current password is required"),
  });

export type EmailFormType = z.infer<ReturnType<typeof emailFormSchema>>;
export type PasswordFormType = z.infer<ReturnType<typeof passwordFormSchema>>;
export type DeleteAccountFormType = z.infer<
  ReturnType<typeof deleteAccountSchema>
>;
