import { z } from "zod";

import { FormData } from "@/lib/form";

const signInFormSchema = (
  t: IntlTranslation<"Auth.Pages.SignIn.Form.Errors">,
) =>
  z.object({
    email: z.string().email({
      message: t("Email.invalid"),
    }),
    password: z.string(),
  });

type SignInFormSchemaType = z.infer<ReturnType<typeof signInFormSchema>>;

const signInFormData: FormData<
  SignInFormSchemaType,
  IntlMessages["Auth"]["Pages"]["SignIn"]["Form"]["Fields"]
> = [
  {
    name: "email",
    labelKey: "Email.label",
    placeholderKey: "Email.placeholder",
  },
  {
    name: "password",
    labelKey: "Password.label",
    placeholderKey: "Password.placeholder",
    type: "password",
  },
];

export { signInFormData, signInFormSchema };
export type { SignInFormSchemaType };
