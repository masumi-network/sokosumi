"use server";

import { auth } from "@/lib/better-auth/auth";

import { forgotPasswordFormSchema, ForgotPasswordFormSchemaType } from "./data";

export async function forgotPassword(formData: ForgotPasswordFormSchemaType) {
  const validatedFields = forgotPasswordFormSchema.safeParse(formData);

  if (!validatedFields.success) {
    return { error: "Invalid email address" };
  }

  const { email } = validatedFields.data;
  await auth.api.forgetPassword({
    body: {
      email,
      redirectTo: "/reset-password",
    },
  });
}
