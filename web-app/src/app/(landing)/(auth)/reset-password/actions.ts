"use server";

import { auth } from "@/lib/better-auth/auth";

import { resetPasswordFormSchema, ResetPasswordFormSchemaType } from "./data";

export async function resetPassword(formData: ResetPasswordFormSchemaType) {
  const validatedFields = resetPasswordFormSchema.safeParse(formData);

  if (!validatedFields.success) {
    throw new Error("Invalid form data");
  }

  const { password, token } = validatedFields.data;

  await auth.api.resetPassword({
    body: {
      newPassword: password,
      token,
    },
  });
}
