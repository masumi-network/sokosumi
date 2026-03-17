import { FormData } from "@/lib/form";
import { SignInFormSchemaType } from "@/lib/schemas";

export const signInFormData: FormData<
  SignInFormSchemaType,
  "Auth.Pages.SignIn.Form"
> = [
  {
    name: "email",
    placeholderKey: "Fields.Email.placeholder",
    autoComplete: "username webauthn",
  },
  {
    name: "currentPassword",
    placeholderKey: "Fields.Password.placeholder",
    type: "password",
  },
  {
    name: "rememberMe",
    labelKey: "Fields.RememberMe.label",
    type: "checkbox",
  },
];
