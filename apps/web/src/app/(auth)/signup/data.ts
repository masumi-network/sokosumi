import type { FormData } from "@/lib/form";
import type {
  SignUpEmailFormSchemaType,
  SignUpFormSchemaType,
} from "@/lib/schemas/auth";

export const signUpEmailFormData: FormData<
  SignUpEmailFormSchemaType,
  "Auth.Pages.SignUp.Form"
> = [
  {
    name: "email",
    labelKey: "Fields.Email.label",
    autoComplete: "email",
  },
];

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

export const signUpFormData: SignUpFormData = [
  {
    name: "password",
    labelKey: "Fields.Password.label",
    type: "password",
    autoComplete: "new-password",
  },
  {
    name: "marketingOptIn",
    type: "checkbox",
    labelKey: "Fields.MarketingOptIn.label",
  },
];
