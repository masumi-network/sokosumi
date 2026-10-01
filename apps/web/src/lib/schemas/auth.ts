import * as z from "zod";

import {
  confirmPasswordSchema,
  emailSchema,
  firstAndLastNameSchema,
  inputPasswordSchema,
  passwordSchema,
} from "@/lib/auth/data";

const socialProviderIdSchema = z.enum(["google", "microsoft", "credential"]);
export type SocialProviderId = z.infer<typeof socialProviderIdSchema>;

/** Every way to sign in, for analytics (`provider` on `sign_up` / `login`). */
export const authMethodIdSchema = z.enum([
  ...socialProviderIdSchema.options,
  "email-otp",
  "passkey",
]);
export type AuthMethodId = z.infer<typeof authMethodIdSchema>;

export const signInFormSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z.object({
    email: emailSchema(t),
    currentPassword: inputPasswordSchema(t),
    rememberMe: z.boolean(),
  });

export type SignInFormSchemaType = z.infer<ReturnType<typeof signInFormSchema>>;

// Sign-up is two steps: the email first, then everything else.
export const signUpEmailFormSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z.object({
    email: emailSchema(t),
  });

export type SignUpEmailFormSchemaType = z.infer<
  ReturnType<typeof signUpEmailFormSchema>
>;

export const signUpFormSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  firstAndLastNameSchema(t).safeExtend({
    password: passwordSchema(t),
    marketingOptIn: z.boolean().optional(),
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
    })
    .refine(({ password, confirmPassword }) => password === confirmPassword, {
      path: ["confirmPassword"],
      error: t?.("ConfirmPassword.match"),
    });

export type ResetPasswordFormSchemaType = z.infer<
  ReturnType<typeof resetPasswordFormSchema>
>;
