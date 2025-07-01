import { z } from "zod";

import {
  confirmPasswordSchema,
  emailSchema,
  inputPasswordSchema,
  nameSchema,
  organizationSchema,
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
      organization: organizationSchema(t),
      termsAccepted: z.boolean(),
      marketingOptIn: z.boolean().optional(),
    })
    .refine(({ password, confirmPassword }) => password === confirmPassword, {
      path: ["confirmPassword"],
      message: t?.("ConfirmPassword.match"),
    });

export type SignUpFormSchemaType = z.infer<ReturnType<typeof signUpFormSchema>>;
