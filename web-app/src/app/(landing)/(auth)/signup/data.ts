import { z } from "zod";

import {
  confirmPasswordSchema,
  emailSchema,
  nameSchema,
  passwordSchema,
} from "@/lib/better-auth/data";
import { FormData } from "@/lib/form";

const signUpFormSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: confirmPasswordSchema,
  })
  .refine(({ password, confirmPassword }) => password === confirmPassword, {
    path: ["confirmPassword"],
  });

type SignUpFormSchemaType = z.infer<typeof signUpFormSchema>;

const signUpFormData: FormData<SignUpFormSchemaType, "Auth.Pages.SignUp.Form"> =
  [
    {
      name: "email",
      labelKey: "Fields.Email.label",
      placeholderKey: "Fields.Email.placeholder",
    },
    {
      name: "name",
      labelKey: "Fields.Name.label",
      placeholderKey: "Fields.Name.placeholder",
    },
    {
      name: "password",
      labelKey: "Fields.Password.label",
      placeholderKey: "Fields.Password.placeholder",
      type: "password",
    },
    {
      name: "confirmPassword",
      labelKey: "Fields.ConfirmPassword.label",
      placeholderKey: "Fields.ConfirmPassword.placeholder",
      type: "password",
    },
  ];

export { signUpFormData, signUpFormSchema };
export type { SignUpFormSchemaType };
