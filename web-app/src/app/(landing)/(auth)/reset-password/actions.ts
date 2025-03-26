"use server";

import { auth } from "@/lib/better-auth/auth";

import { resetPasswordFormSchema, ResetPasswordFormSchemaType } from "./data";

export async function resetPassword(
  formData: ResetPasswordFormSchemaType,
): Promise<{ success: boolean; error?: string }> {
  const validatedFields = resetPasswordFormSchema().safeParse(formData);

  if (!validatedFields.success) {
    throw new Error("Invalid form data");
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
    return { success: false };
  }
}
