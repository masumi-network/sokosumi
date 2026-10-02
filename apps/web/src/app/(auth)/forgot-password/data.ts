import type { FormData } from "@/lib/form";
import type { ForgotPasswordFormSchemaType } from "@/lib/schemas/auth";

export const forgotPasswordFormData: FormData<
  ForgotPasswordFormSchemaType,
  "Auth.Pages.ForgotPassword.Form"
> = [
  {
    name: "email",
    labelKey: "Fields.Email.label",
    type: "email",
    autoComplete: "email",
  },
];
