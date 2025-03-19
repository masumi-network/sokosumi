"use server";

import { z } from "zod";

import { auth } from "@/lib/better-auth/auth";

import { passwordSchema } from "../data";

const signupSchema = z.object({
  email: z.string().email(),
  username: z.string().min(2).max(50),
  password: passwordSchema,
});

export async function signup(formData: FormData) {
  const validatedFields = signupSchema.safeParse({
    email: formData.get("email"),
    username: formData.get("username"),
    password: formData.get("password"),
  });

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
