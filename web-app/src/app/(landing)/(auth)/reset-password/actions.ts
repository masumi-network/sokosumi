"use server";

import { z } from "zod";

import { auth } from "@/lib/better-auth/auth";

import { passwordSchema } from "../data";

const resetPasswordSchema = z.object({
  password: passwordSchema,
  token: z.string(),
});

export async function resetPassword(formData: FormData) {
  const validatedFields = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    token: formData.get("token"),
  });

  if (!validatedFields.success) {
    return { error: "Invalid form data" };
  }

  const { password, token } = validatedFields.data;

  try {
    await auth.api.resetPassword({
      body: {
        newPassword: password,
        token,
      },
    });
    return { success: true };
  } catch {
    return { error: "Failed to reset password" };
  }
}
