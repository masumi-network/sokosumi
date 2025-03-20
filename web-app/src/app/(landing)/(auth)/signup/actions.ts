"use server";

import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/better-auth/auth";

import { signUpFormSchema } from "./data";

export async function signup(formData: FormData) {
  const t = await getTranslations("Auth.Pages.SignUp.Form");
  const validatedFields = signUpFormSchema(t).safeParse({
    email: formData.get("email"),
    username: formData.get("username"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
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
