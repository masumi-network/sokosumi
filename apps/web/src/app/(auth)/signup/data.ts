import type { FormData } from "@/lib/form";
import type { SignUpFormSchemaType } from "@/lib/schemas/auth";

type SignUpFormData = FormData<SignUpFormSchemaType, "Auth.Pages.SignUp.Form">;

export const signUpMarketingFormData: SignUpFormData = [
  {
    name: "marketingOptIn",
    type: "checkbox",
    labelKey: "Fields.MarketingOptIn.label",
  },
];
