import { z } from "zod";

import { FormData, FormIntlTranslation } from "@/lib/form";

export const resetPasswordFormSchema = (
  t: FormIntlTranslation<"Auth.Pages.ResetPassword.Form">,
) =>
  z
    .object({
      password: z
        .string()
        .min(8, t("Errors.Password.min"))
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
          message: t("Errors.Password.regex"),
        }),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t("Errors.ConfirmPassword.match"),
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
