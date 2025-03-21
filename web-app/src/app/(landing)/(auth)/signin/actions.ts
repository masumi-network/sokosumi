"use server";

import { auth } from "@/lib/better-auth/auth";

import { signInFormSchema, SignInFormSchemaType } from "./data";

export async function signin(formData: SignInFormSchemaType) {
  const validatedFields = signInFormSchema.safeParse(formData);

  if (!validatedFields.success) {
    return { error: "Invalid form data" };
  }

  const { email, password } = validatedFields.data;

  await auth.api.signInEmail({
    body: {
      email,
      password,
    },
  });
}
