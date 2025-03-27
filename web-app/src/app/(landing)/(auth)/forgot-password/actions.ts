"use server";

import { auth } from "@/lib/better-auth/auth";
import { LandingRoute } from "@/types/routes";

import { forgotPasswordFormSchema, ForgotPasswordFormSchemaType } from "./data";

export async function forgotPassword(
  formData: ForgotPasswordFormSchemaType,
): Promise<{ success: boolean; error?: string }> {
  const validatedFields = forgotPasswordFormSchema().safeParse(formData);

  if (!validatedFields.success) {
    throw new Error("Invalid email address");
  }

  const { email } = validatedFields.data;

  try {
    await auth.api.forgetPassword({
      body: {
        email,
        redirectTo: LandingRoute.ResetPassword,
      },
    });
    return { success: true };
  } catch {
    return { success: false };
  }
}
