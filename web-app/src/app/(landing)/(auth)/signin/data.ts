import { z } from "zod";

import { currentPasswordSchema, emailSchema } from "@/lib/better-auth/data";
import { FormData } from "@/lib/form";

const signInFormSchema = z.object({
  email: emailSchema,
  currentPassword: currentPasswordSchema,
});

type SignInFormSchemaType = z.infer<typeof signInFormSchema>;

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
