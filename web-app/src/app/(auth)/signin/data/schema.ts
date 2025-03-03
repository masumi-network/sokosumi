import { z } from "zod";

const signInFormSchema = z.object({
  email: z.string().email({
    message: "Please enter a valid email address.",
  }),
  password: z.string(),
});

type SignInFormSchemaType = z.infer<typeof signInFormSchema>;

export { signInFormSchema };
export type { SignInFormSchemaType };
