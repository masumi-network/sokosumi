import { z } from "zod";

import { emailSchema } from "@/lib/better-auth/data";
import { FormData } from "@/lib/form";

const forgotPasswordFormSchema = z.object({
  email: emailSchema,
});

type ForgotPasswordFormSchemaType = z.infer<typeof forgotPasswordFormSchema>;

const forgotPasswordFormData: FormData<
  ForgotPasswordFormSchemaType,
  "Auth.Pages.ForgotPassword.Form"
> = [
  {
    name: "email",
    labelKey: "Fields.Email.label",
    placeholderKey: "Fields.Email.placeholder",
  },
];

export { forgotPasswordFormData, forgotPasswordFormSchema };
export type { ForgotPasswordFormSchemaType };
