import type { FormData } from "@/lib/form";
import type { SignUpFormSchemaType } from "@/lib/schemas";

export const signUpFormData: FormData<
  SignUpFormSchemaType,
  "Auth.Pages.SignUp.Form"
> = [
  {
    name: "email",
    placeholderKey: "Fields.Email.placeholder",
  },
  {
    name: "password",
    placeholderKey: "Fields.Password.placeholder",
    type: "password",
  },
  {
    name: "termsAccepted",
    type: "checkbox",
  },
  {
    name: "marketingOptIn",
    type: "checkbox",
    labelKey: "Fields.MarketingOptIn.label",
  },
];
