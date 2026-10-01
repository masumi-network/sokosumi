import type { FormData } from "@/lib/form";
import type { SignUpFormSchemaType } from "@/lib/schemas/auth";

type SignUpFormData = FormData<SignUpFormSchemaType, "Auth.Pages.SignUp.Form">;

// Rendered side by side on one row, above the rest of the form.
export const signUpNameFormData: SignUpFormData = [
  {
    name: "firstName",
    labelKey: "Fields.FirstName.label",
    autoComplete: "given-name",
  },
  {
    name: "lastName",
    labelKey: "Fields.LastName.label",
    autoComplete: "family-name",
  },
];

// An email code replaces the password, so the two are rendered apart.
export const signUpPasswordFormData: SignUpFormData = [
  {
    name: "password",
    labelKey: "Fields.Password.label",
    type: "password",
    autoComplete: "new-password",
  },
];

export const signUpMarketingFormData: SignUpFormData = [
  {
    name: "marketingOptIn",
    type: "checkbox",
    labelKey: "Fields.MarketingOptIn.label",
  },
];
