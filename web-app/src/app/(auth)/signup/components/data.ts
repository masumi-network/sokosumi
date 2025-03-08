import { z } from "zod";

import { FormData } from "@/lib/form";

const signUpFormSchema = z
  .object({
    username: z
      .string()
      .min(2, {
        message: "User Name must be at least 2 characters.",
      })
      .max(50, { message: "User Name must be maximum 50 characters." }),
    email: z.string().email({
      message: "Please enter a valid email address.",
    }),
    password: z
      .string()
      .min(8, {
        message: "Password must be at least 8 characters.",
      })
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message:
          "Password must contain at least one uppercase letter, one lowercase letter, and one number.",
      }),
    confirmPassword: z.string(),
  })
  .refine(({ password, confirmPassword }) => password === confirmPassword, {
    message: "Password doesn't match",
    path: ["confirmPassword"],
  });

type SignUpFormSchemaType = z.infer<typeof signUpFormSchema>;

const signUpFormData: FormData<SignUpFormSchemaType> = [
  { name: "email", label: "Email", placeholder: "me@example.com" },
  { name: "username", label: "User Name", placeholder: "Jhon Doe" },
  {
    name: "password",
    label: "Password",
    placeholder: "Password",
    type: "password",
  },
  {
    name: "confirmPassword",
    label: "Confirm Password",
    placeholder: "Confirm Password",
    type: "password",
  },
];

export { signUpFormData, signUpFormSchema };
export type { SignUpFormSchemaType };
