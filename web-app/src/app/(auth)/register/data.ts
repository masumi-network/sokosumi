import { z } from "zod";

import {
  confirmPasswordSchema,
  emailSchema,
  nameSchema,
  organizationIdSchema,
  passwordSchema,
} from "@/lib/auth/data";
import { FormData } from "@/lib/form";

const signUpFormSchema = (t?: IntlTranslation<"Library.Auth.Schema">) =>
  z
    .object({
      name: nameSchema(t),
      email: emailSchema(t),
      password: passwordSchema(t),
      confirmPassword: confirmPasswordSchema(t),
      organizationId: organizationIdSchema(t),
      termsAccepted: z.boolean(),
      marketingOptIn: z.boolean().optional(),
    })
    .refine(({ password, confirmPassword }) => password === confirmPassword, {
      path: ["confirmPassword"],
      message: t?.("ConfirmPassword.match"),
    });

type SignUpFormSchemaType = z.infer<ReturnType<typeof signUpFormSchema>>;

const signUpFormData: FormData<SignUpFormSchemaType, "Auth.Pages.SignUp.Form"> =
  [
    {
      name: "name",
      placeholderKey: "Fields.Name.placeholder",
    },
    {
      name: "email",
      placeholderKey: "Fields.Email.placeholder",
    },
    {
      name: "organizationId",
    },
    {
      name: "password",
      placeholderKey: "Fields.Password.placeholder",
      type: "password",
    },
    {
      name: "confirmPassword",
      placeholderKey: "Fields.ConfirmPassword.placeholder",
      type: "password",
    },
    {
      name: "termsAccepted",
      type: "checkbox",
    },
    {
      name: "marketingOptIn",
      type: "checkbox",
      labelKey: "Fields.MarketingOptIn.label",
    },
  ];

export { signUpFormData, signUpFormSchema };
export type { SignUpFormSchemaType };
