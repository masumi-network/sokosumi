import { z } from "zod";

import { FormData, FormIntlTranslation } from "@/lib/form";

import { passwordSchema } from "../data";

export const resetPasswordFormSchema = (
  t:
    | FormIntlTranslation<"Auth.Pages.ResetPassword.Form">
    | undefined = undefined,
) =>
  z
    .object({
      password: passwordSchema({
        minError: t?.("Errors.Password.min"),
        regexError: t?.("Errors.Password.regex"),
      }),
      confirmPassword: z.string(),
      token: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t?.("Errors.ConfirmPassword.match"),
      path: ["confirmPassword"],
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
