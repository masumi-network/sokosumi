import { z } from "zod";

import { FormData } from "@/lib/form";

import { emailSchema } from "../data";

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
