import { FormData } from "@/lib/form";
import { ResetPasswordFormSchemaType } from "@/lib/schemas";

export const resetPasswordFormData: FormData<
  ResetPasswordFormSchemaType,
  "Auth.Pages.ResetPassword.Form"
> = [
  {
    name: "password",
    placeholderKey: "Fields.Password.placeholder",
    type: "password",
  },
  {
    name: "confirmPassword",
    placeholderKey: "Fields.ConfirmPassword.placeholder",
    type: "password",
  },
];
