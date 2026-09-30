import type { FormData } from "@/lib/form";
import type { SignUpFormSchemaType } from "@/lib/schemas/auth";

export const signUpFormData: FormData<
  SignUpFormSchemaType,
  "Auth.Pages.SignUp.Form"
> = [
  {
    name: "name",
    placeholderKey: "Fields.Name.placeholder",
    autoComplete: "name",
  },
  {
    name: "email",
    placeholderKey: "Fields.Email.placeholder",
    autoComplete: "email",
  },
  {
    name: "password",
    placeholderKey: "Fields.Password.placeholder",
    type: "password",
    autoComplete: "new-password",
  },
  {
    name: "marketingOptIn",
    type: "checkbox",
    labelKey: "Fields.MarketingOptIn.label",
  },
];
