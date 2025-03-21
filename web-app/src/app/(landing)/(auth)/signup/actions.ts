"use server";

import { auth } from "@/lib/better-auth/auth";

import { signUpFormSchema, SignUpFormSchemaType } from "./data";

export async function signup(formData: SignUpFormSchemaType): Promise<void> {
  const validatedFields = signUpFormSchema.safeParse(formData);

  if (!validatedFields.success) {
    throw new Error("Invalid form data");
  }

  const { email, name, password } = validatedFields.data;

  await auth.api.signUpEmail({
    body: {
      name,
      email,
      password,
    },
  });
}
