import type { FormData } from "@/lib/form";
import type { ResetPasswordFormSchemaType } from "@/lib/schemas/auth";

export const resetPasswordFormData: FormData<
  ResetPasswordFormSchemaType,
  "Auth.Pages.ResetPassword.Form"
> = [
  {
    name: "password",
    labelKey: "Fields.Password.label",
    type: "password",
    autoComplete: "new-password",
  },
  {
    name: "confirmPassword",
    labelKey: "Fields.ConfirmPassword.label",
    type: "password",
    autoComplete: "new-password",
  },
];
