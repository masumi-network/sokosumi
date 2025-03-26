import { z } from "zod";

import { emailSchema, inputPasswordSchema } from "@/lib/better-auth/data";
import { FormData } from "@/lib/form";

const signInFormSchema = (t?: IntlTranslation<"Auth.Schema">) =>
  z.object({
    email: emailSchema(t),
    currentPassword: inputPasswordSchema(t),
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
      name: "currentPassword",
      labelKey: "Fields.Password.label",
      placeholderKey: "Fields.Password.placeholder",
      type: "password",
    },
  ];

export { signInFormData, signInFormSchema };
export type { SignInFormSchemaType };
