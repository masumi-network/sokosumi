"use server";

import { auth } from "@/lib/auth/auth";

import { signInFormSchema, SignInFormSchemaType } from "./data";

export async function signin(
  formData: SignInFormSchemaType,
): Promise<{ success: boolean; error?: string }> {
  const validatedFields = signInFormSchema().safeParse(formData);

  if (!validatedFields.success) {
    throw new Error("Invalid form data");
  }

  const { email, currentPassword } = validatedFields.data;

  try {
    await auth.api.signInEmail({
      body: {
        email,
        password: currentPassword,
      },
    });
    return { success: true };
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) {
      if (error.statusCode === 403) {
        return { success: false, error: "emailNotVerified" };
      }
    }
    return { success: false };
  }
}
