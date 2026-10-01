import type { FormData } from "@/lib/form";
import type { SignInFormSchemaType } from "@/lib/schemas/auth";

export const signInRememberMeFormData: FormData<
  SignInFormSchemaType,
  "Auth.Pages.SignIn.Form"
> = [
  {
    name: "rememberMe",
    labelKey: "Fields.RememberMe.label",
    type: "checkbox",
  },
];
