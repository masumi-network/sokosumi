import { z } from "zod";

import { FormIntlTranslation } from "@/lib/form";

export const resetPasswordFormSchema = (
  t: FormIntlTranslation<"Auth.Pages.ResetPassword.Form">,
) =>
  z
    .object({
      password: z
        .string()
        .min(8, t("password_min_length"))
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
          message: t("password_regex"),
        }),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t("passwords_must_match"),
      path: ["confirmPassword"],
    });

export type ResetPasswordFormSchemaType = z.infer<
  ReturnType<typeof resetPasswordFormSchema>
>;

export const resetPasswordFormData = [
  {
    name: "password" as const,
    labelKey: "password",
    placeholderKey: "enter_new_password",
    type: "password",
  },
  {
    name: "confirmPassword" as const,
    labelKey: "confirm_password",
    placeholderKey: "confirm_new_password",
    type: "password",
  },
] as const;
