import type { FormData } from "@/lib/form";
import type { ForgotPasswordFormSchemaType } from "@/lib/schemas";

export const forgotPasswordFormData: FormData<
  ForgotPasswordFormSchemaType,
  "Auth.Pages.ForgotPassword.Form"
> = [
  {
    name: "email",
    placeholderKey: "Fields.Email.placeholder",
  },
];
