import { FormData } from "@/lib/form";
import { SignUpFormSchemaType } from "@/lib/schemas";

export const signUpFormData: FormData<
  SignUpFormSchemaType,
  "Auth.Pages.SignUp.Form"
> = [
  {
    name: "name",
    placeholderKey: "Fields.Name.placeholder",
  },
  {
    name: "email",
    placeholderKey: "Fields.Email.placeholder",
  },
  {
    name: "selectedOrganization",
  },
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
