import { z } from "zod";

import { FormData } from "@/lib/form";

const signInFormSchema = z.object({
  email: z.string().email({
    message: "Please enter a valid email address.",
  }),
  password: z.string(),
});

type SignInFormSchemaType = z.infer<typeof signInFormSchema>;

const signInFormData: FormData<SignInFormSchemaType> = [
  { name: "email", label: "Email", placeholder: "me@example.com" },
  {
    name: "password",
    label: "Password",
    placeholder: "Password",
    type: "password",
  },
];

export { signInFormData, signInFormSchema };
export type { SignInFormSchemaType };
