"use server";

import { auth } from "@/lib/better-auth/auth";

import { signUpFormSchema, SignUpFormSchemaType } from "./data";

export async function signup(formData: SignUpFormSchemaType) {
  const validatedFields = signUpFormSchema().safeParse(formData);

  if (!validatedFields.success) {
    return { error: "Invalid form data" };
  }

  const { email, username, password } = validatedFields.data;

  try {
    await auth.api.signUpEmail({
      body: {
        name: username,
        email,
        password,
      },
    });
    return { success: true };
  } catch {
    return { error: "Failed to create account" };
  }
}
