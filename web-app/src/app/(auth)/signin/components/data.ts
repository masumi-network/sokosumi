import { z } from "zod";

import { FormData } from "@/lib/form";

const signInFormSchema = (t: IntlTranslation<"Auth.Pages.SignIn.Form">) =>
  z.object({
    email: z.string().email({
      message: t("Errors.Email.invalid"),
    }),
    password: z.string(),
  });

type SignInFormSchemaType = z.infer<ReturnType<typeof signInFormSchema>>;

const signInFormData: FormData<SignInFormSchemaType, "Auth.Pages.SignIn.Form"> =
  [
    {
      name: "email",
      labelKey: "Fields.Email.label",
      placeholderKey: "Fields.Email.placeholder",
    },
    {
      name: "password",
      labelKey: "Fields.Password.label",
      placeholderKey: "Fields.Password.placeholder",
      type: "password",
    },
  ];

export { signInFormData, signInFormSchema };
export type { SignInFormSchemaType };
