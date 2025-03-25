"use server";

import { auth } from "@/lib/better-auth/auth";

import { signUpFormSchema, SignUpFormSchemaType } from "./data";

export async function signup(
  formData: SignUpFormSchemaType,
): Promise<{ success: boolean; error?: string }> {
  const validatedFields = signUpFormSchema().safeParse(formData);

  if (!validatedFields.success) {
    throw new Error("Invalid form data");
  }

  const { email, name, password } = validatedFields.data;

  try {
    await auth.api.signUpEmail({
      body: {
        name,
        email,
        password,
      },
    });
    return { success: true };
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) {
      if (error.statusCode === 422) {
        return { success: false, error: "userExists" };
      }
    }
    return { success: false };
  }
}
