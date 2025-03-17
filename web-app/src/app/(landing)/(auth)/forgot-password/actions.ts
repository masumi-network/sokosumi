"use server";

import { z } from "zod";

import { auth } from "@/lib/auth";

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export async function forgotPassword(formData: FormData) {
  const validatedFields = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!validatedFields.success) {
    return { error: "Invalid email address" };
  }

  const { email } = validatedFields.data;
  try {
    await auth.api.forgetPassword({
      body: {
        email,
        redirectTo: "/reset-password",
      },
    });
    return { success: true };
  } catch {
    return { error: "Failed to send password reset email" };
  }
}
