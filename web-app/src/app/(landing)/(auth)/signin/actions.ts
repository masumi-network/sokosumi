"use server";

import { auth } from "@/lib/better-auth/auth";

import { signInFormSchema, SignInFormSchemaType } from "./data";

export async function signin(formData: SignInFormSchemaType): Promise<void> {
  const validatedFields = signInFormSchema.safeParse(formData);

  if (!validatedFields.success) {
    throw new Error("Invalid form data");
  }

  const { email, currentPassword } = validatedFields.data;

  await auth.api.signInEmail({
    body: {
      email,
      password: currentPassword,
    },
  });
}
