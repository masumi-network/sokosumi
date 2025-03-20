"use server";

import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/better-auth/auth";

import { resetPasswordFormSchema } from "./data";

export async function resetPassword(formData: FormData) {
  const t = await getTranslations("Auth.Pages.ResetPassword.Form");
  const validatedFields = resetPasswordFormSchema(t).safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
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
