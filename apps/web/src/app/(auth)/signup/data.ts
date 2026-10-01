import type { FormData } from "@/lib/form";
import type { SignUpFormSchemaType } from "@/lib/schemas/auth";

type SignUpFormData = FormData<SignUpFormSchemaType, "Auth.Pages.SignUp.Form">;

// An email code replaces the password, so the two are rendered apart.
export const signUpPasswordFormData: SignUpFormData = [
  {
    name: "password",
    labelKey: "Fields.Password.label",
    // Shown up front, so the rule is known before a submit fails on it.
    descriptionKey: "Fields.Password.description",
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
