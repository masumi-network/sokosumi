import { z } from "zod";

import { emailSchema } from "@/lib/auth/data";
import { FormData } from "@/lib/form";

const forgotPasswordFormSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z.object({
    email: emailSchema(t),
  });

type ForgotPasswordFormSchemaType = z.infer<
  ReturnType<typeof forgotPasswordFormSchema>
>;

const forgotPasswordFormData: FormData<
  ForgotPasswordFormSchemaType,
  "Landing.Auth.Pages.ForgotPassword.Form"
> = [
  {
    name: "email",
    labelKey: "Fields.Email.label",
    placeholderKey: "Fields.Email.placeholder",
  },
];

export { forgotPasswordFormData, forgotPasswordFormSchema };
export type { ForgotPasswordFormSchemaType };
