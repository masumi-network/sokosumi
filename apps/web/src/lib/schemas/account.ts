import * as z from "zod";

import {
  confirmPasswordSchema,
  currentPasswordSchema,
  emailSchema,
  nameSchema,
  passwordSchema,
} from "@/lib/auth/data";

const emptyOrHttpUrlSchema = z.union([z.literal(""), z.httpUrl()]);

export const nameFormSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z.object({
    name: nameSchema(t),
  });

export type NameFormType = z.infer<ReturnType<typeof nameFormSchema>>;

export const emailFormSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z.object({
    email: emailSchema(t),
  });

export type EmailFormType = z.infer<ReturnType<typeof emailFormSchema>>;

export const passwordFormSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z
    .object({
      currentPassword: currentPasswordSchema(t),
      newPassword: passwordSchema(t),
      confirmNewPassword: confirmPasswordSchema(t),
    })
    .refine((data) => data.newPassword === data.confirmNewPassword, {
      path: ["confirmNewPassword"],
      error: t?.("ConfirmPassword.match"),
    });

export type PasswordFormType = z.infer<ReturnType<typeof passwordFormSchema>>;

export const newPasswordFormSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z
    .object({
      newPassword: passwordSchema(t),
      confirmNewPassword: confirmPasswordSchema(t),
    })
    .refine((data) => data.newPassword === data.confirmNewPassword, {
      path: ["confirmNewPassword"],
      error: t?.("ConfirmPassword.match"),
    });

export type NewPasswordFormType = z.infer<
  ReturnType<typeof newPasswordFormSchema>
>;

export const deleteAccountSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z.object({
    currentPassword: currentPasswordSchema(t),
  });

export type DeleteAccountFormType = z.infer<
  ReturnType<typeof deleteAccountSchema>
>;

export const brandProfileFormSchema = (
  t?: IntlTranslation<"App.Account.BrandProfile.Schema">,
) =>
  z.object({
    logo: z.string().nullable().optional(),
    websiteUrl: z
      .string()
      .trim()
      .refine((value) => emptyOrHttpUrlSchema.safeParse(value).success, {
        error: t?.("websiteUrl"),
      }),
  });

export type BrandProfileFormType = z.infer<
  ReturnType<typeof brandProfileFormSchema>
>;
