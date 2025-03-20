"use server";

import { auth } from "@/lib/better-auth/auth";

import { resetPasswordFormSchema, ResetPasswordFormSchemaType } from "./data";

export async function resetPassword(formData: ResetPasswordFormSchemaType) {
  const validatedFields = resetPasswordFormSchema().safeParse(formData);

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
