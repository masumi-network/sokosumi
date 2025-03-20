import { z } from "zod";

import { FormData, FormIntlTranslation } from "@/lib/form";

const forgotPasswordFormSchema = (
  t:
    | FormIntlTranslation<"Auth.Pages.ForgotPassword.Form">
    | undefined = undefined,
) =>
  z.object({
    email: z.string().email({
      message: t?.("Errors.Email.invalid"),
    }),
  });

export type ForgotPasswordFormSchemaType = z.infer<
  ReturnType<typeof forgotPasswordFormSchema>
>;

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
