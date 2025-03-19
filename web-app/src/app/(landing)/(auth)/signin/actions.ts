"use server";

import { z } from "zod";

import { auth } from "@/lib/better-auth/auth";

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function signin(formData: FormData) {
  const validatedFields = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!validatedFields.success) {
    return { error: "Invalid form data" };
  }

  const { email, password } = validatedFields.data;

  try {
    await auth.api.signInEmail({
      body: {
        email,
        password,
      },
    });
    return { success: true };
  } catch (error) {
    console.log(error);
    if (error && typeof error === "object" && "statusCode" in error) {
      if (error.statusCode === 403) {
        return { error: "Please verify your email address" };
      }
    }
    return { error: "Invalid email or password" };
  }
}
