import { z } from "zod";

import { confirmPasswordSchema, passwordSchema } from "@/lib/better-auth/data";
import { FormData } from "@/lib/form";

export const resetPasswordFormSchema = (t?: IntlTranslation<"Auth.Schema">) =>
  z
    .object({
      password: passwordSchema(t),
      confirmPassword: confirmPasswordSchema(t),
      token: z.string(),
    })
    .refine(({ password, confirmPassword }) => password === confirmPassword, {
      path: ["confirmPassword"],
      message: t?.("ConfirmPassword.match"),
    });

export type ResetPasswordFormSchemaType = z.infer<
  ReturnType<typeof resetPasswordFormSchema>
>;

export const resetPasswordFormData: FormData<
  ResetPasswordFormSchemaType,
  "Auth.Pages.ResetPassword.Form"
> = [
  {
    name: "password",
    labelKey: "Fields.Password.label",
    placeholderKey: "Fields.Password.placeholder",
    type: "password",
  },
  {
    name: "confirmPassword",
    labelKey: "Fields.ConfirmPassword.label",
    placeholderKey: "Fields.ConfirmPassword.placeholder",
    type: "password",
  },
];
