"use server";

import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/better-auth/auth";

import { forgotPasswordFormSchema } from "./data";

export async function forgotPassword(formData: FormData) {
  const t = await getTranslations("Auth.Pages.ForgotPassword.Form");
  const validatedFields = forgotPasswordFormSchema(t).safeParse({
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
