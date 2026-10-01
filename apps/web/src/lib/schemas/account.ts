import {
  isEmptyOrValidWebsiteUrl,
  isFirstAndLastNameWithinLimit,
} from "@sokosumi/utils";
import * as z from "zod";

import {
  confirmPasswordSchema,
  currentPasswordSchema,
  emailSchema,
  firstAndLastNameSchema,
  nameSchema,
  passwordSchema,
} from "@/lib/auth/data";

export const nameFormSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z.object({
    name: nameSchema(t),
  });

export type NameFormType = z.infer<ReturnType<typeof nameFormSchema>>;

export const firstAndLastNameFormSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) => firstAndLastNameSchema(t);

export type FirstAndLastNameFormType = z.infer<
  ReturnType<typeof firstAndLastNameFormSchema>
>;

/**
 * Account page: first name, last name and display name in one form. A user
 * from before the name parts existed may leave both empty; filling one, or
 * already having them, makes both required.
 */
export const accountNameFormSchema = (
  t: IntlTranslation<"Library.Auth.Schema"> | undefined,
  { namePartsRequired }: { namePartsRequired: boolean },
) =>
  z
    .object({
      firstName: z.string().trim(),
      lastName: z.string().trim(),
      name: nameSchema(t),
    })
    .superRefine(({ firstName, lastName }, ctx) => {
      if (!namePartsRequired && !firstName && !lastName) {
        return;
      }
      if (!firstName) {
        ctx.addIssue({
          code: "custom",
          path: ["firstName"],
          message: t?.("FirstName.required"),
        });
      }
      if (!lastName) {
        ctx.addIssue({
          code: "custom",
          path: ["lastName"],
          message: t?.("LastName.required"),
        });
      }
    })
    .refine(
      ({ firstName, lastName }) =>
        isFirstAndLastNameWithinLimit(firstName, lastName),
      {
        path: ["lastName"],
        error: t?.("FullName.max"),
      },
    );

export type AccountNameFormType = z.infer<
  ReturnType<typeof accountNameFormSchema>
>;

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
      revokeOtherSessions: z.boolean(),
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

/**
 * A viewer with a password confirms with it. One without (a social or
 * email-code sign-up) types the account's email instead, and Core gates the
 * delete on a fresh session.
 */
export const deleteAccountSchema = (
  t: IntlTranslation<"Library.Auth.Schema"> | undefined,
  {
    hasPassword,
    accountEmail,
  }: { hasPassword: boolean; accountEmail: string | undefined },
) =>
  z.object({
    currentPassword: hasPassword ? currentPasswordSchema(t) : z.string(),
    confirmEmail: z
      .string()
      .trim()
      .refine(
        (value) =>
          hasPassword ||
          (value !== "" && value.toLowerCase() === accountEmail?.toLowerCase()),
        { error: t?.("Email.confirmationMismatch") },
      ),
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
      .refine((value) => isEmptyOrValidWebsiteUrl(value), {
        error: t?.("websiteUrl"),
      }),
  });

export type BrandProfileFormType = z.infer<
  ReturnType<typeof brandProfileFormSchema>
>;
