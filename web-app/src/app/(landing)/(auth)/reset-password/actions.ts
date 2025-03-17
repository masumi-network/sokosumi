"use server";

import { z } from "zod";

import { authClient } from "@/lib/auth.client";

const passwordSchema = z
  .string()
  .min(8)
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/);

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
    await authClient.resetPassword({
      newPassword: password,
      token,
    });
    return { success: true };
  } catch {
    return { error: "Failed to reset password" };
  }
}
