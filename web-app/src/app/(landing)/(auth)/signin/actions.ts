"use server";

import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/better-auth/auth";

import { signInFormSchema } from "./data";

export async function signin(formData: FormData) {
  const t = await getTranslations("Auth.Pages.SignIn.Form");
  const validatedFields = signInFormSchema(t).safeParse({
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
