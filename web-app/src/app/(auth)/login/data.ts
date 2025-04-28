import { z } from "zod";

import { emailSchema, inputPasswordSchema } from "@/lib/auth/data";
import { FormData } from "@/lib/form";

const signInFormSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z.object({
    email: emailSchema(t),
    currentPassword: inputPasswordSchema(t),
    rememberMe: z.boolean(),
  });

type SignInFormSchemaType = z.infer<ReturnType<typeof signInFormSchema>>;

const signInFormData: FormData<SignInFormSchemaType, "Auth.Pages.SignIn.Form"> =
  [
    {
      name: "email",
      placeholderKey: "Fields.Email.placeholder",
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

export { signInFormData, signInFormSchema };
export type { SignInFormSchemaType };
