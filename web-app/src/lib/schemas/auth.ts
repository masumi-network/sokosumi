import { z } from "zod";

import {
  confirmPasswordSchema,
  emailSchema,
  inputPasswordSchema,
  nameSchema,
  passwordSchema,
} from "@/lib/auth/data";

export const signInFormSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z.object({
    email: emailSchema(t),
    currentPassword: inputPasswordSchema(t),
    rememberMe: z.boolean(),
  });

export type SignInFormSchemaType = z.infer<ReturnType<typeof signInFormSchema>>;

export const signUpFormSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z
    .object({
      name: nameSchema(t),
      email: emailSchema(t),
      password: passwordSchema(t),
      confirmPassword: confirmPasswordSchema(t),
      termsAccepted: z.boolean(),
      marketingOptIn: z.boolean().optional(),
    })
    .refine(({ password, confirmPassword }) => password === confirmPassword, {
      path: ["confirmPassword"],
      error: t?.("ConfirmPassword.match"),
    });

export type SignUpFormSchemaType = z.infer<ReturnType<typeof signUpFormSchema>>;

export const forgotPasswordFormSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z.object({
    email: emailSchema(t),
  });

export type ForgotPasswordFormSchemaType = z.infer<
  ReturnType<typeof forgotPasswordFormSchema>
>;

export const resetPasswordFormSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z
    .object({
      password: passwordSchema(t),
      confirmPassword: confirmPasswordSchema(t),
      token: z.string(),
    })
    .refine(({ password, confirmPassword }) => password === confirmPassword, {
      path: ["confirmPassword"],
      error: t?.("ConfirmPassword.match"),
    });

export type ResetPasswordFormSchemaType = z.infer<
  ReturnType<typeof resetPasswordFormSchema>
>;
