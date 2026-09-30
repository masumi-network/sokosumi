import type { FormData } from "@/lib/form";
import type { SignUpFormSchemaType } from "@/lib/schemas/auth";

type SignUpFormData = FormData<SignUpFormSchemaType, "Auth.Pages.SignUp.Form">;

// Rendered side by side on one row, above the rest of the form.
export const signUpNameFormData: SignUpFormData = [
  {
    name: "firstName",
    placeholderKey: "Fields.FirstName.placeholder",
    autoComplete: "given-name",
  },
  {
    name: "lastName",
    placeholderKey: "Fields.LastName.placeholder",
    autoComplete: "family-name",
  },
];

export const signUpFormData: SignUpFormData = [
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
