import { z } from "zod";

import { FormData, FormIntlTranslation } from "@/lib/form";

import { passwordSchema } from "../data";

const signUpFormSchema = (
  t: FormIntlTranslation<"Auth.Pages.SignUp.Form"> | undefined = undefined,
) =>
  z
    .object({
      username: z
        .string()
        .min(2, t?.("Errors.Username.min"))
        .max(50, t?.("Errors.Username.max"))
        .regex(/^\S*$/, t?.("Errors.Username.regex")),
      email: z.string().email(t?.("Errors.Email.invalid")),
      password: passwordSchema({
        minError: t?.("Errors.Password.min"),
        regexError: t?.("Errors.Password.regex"),
      }),
      confirmPassword: z.string(),
    })
    .refine(({ password, confirmPassword }) => password === confirmPassword, {
      message: t?.("Errors.ConfirmPassword.match"),
      path: ["confirmPassword"],
    });

type SignUpFormSchemaType = z.infer<ReturnType<typeof signUpFormSchema>>;

const signUpFormData: FormData<SignUpFormSchemaType, "Auth.Pages.SignUp.Form"> =
  [
    {
      name: "email",
      labelKey: "Fields.Email.label",
      placeholderKey: "Fields.Email.placeholder",
    },
    {
      name: "username",
      labelKey: "Fields.Username.label",
      placeholderKey: "Fields.Username.placeholder",
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
