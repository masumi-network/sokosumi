"use server";

import { headers } from "next/headers";

import { auth } from "@/lib/auth/auth";

import {
  DeleteAccountFormType,
  deleteAccountSchema,
  emailFormSchema,
  EmailFormType,
  nameFormSchema,
  NameFormType,
  passwordFormSchema,
  PasswordFormType,
} from "./data";

export async function updateName(
  formData: NameFormType,
): Promise<{ success: boolean; error?: string }> {
  const validatedFields = nameFormSchema().safeParse(formData);

  if (!validatedFields.success) {
    return { success: false, error: "Invalid form data" };
  }

  const { name } = validatedFields.data;

  try {
    await auth.api.updateUser({
      body: {
        name,
      },
      headers: await headers(),
    });
    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function updateEmail(
  formData: EmailFormType,
): Promise<{ success: boolean; error?: string }> {
  const validatedFields = emailFormSchema().safeParse(formData);

  if (!validatedFields.success) {
    return { success: false, error: "Invalid form data" };
  }

  const { email } = validatedFields.data;

  try {
    await auth.api.changeEmail({
      body: {
        newEmail: email,
        callbackURL: "/app",
      },
      headers: await headers(),
    });
    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function updatePassword(
  formData: PasswordFormType,
): Promise<{ success: boolean; error?: string }> {
  const validatedFields = passwordFormSchema().safeParse(formData);

  if (!validatedFields.success) {
    return { success: false, error: "Invalid form data" };
  }

  const { currentPassword, newPassword } = validatedFields.data;

  try {
    await auth.api.changePassword({
      body: {
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function deleteAccount(
  formData: DeleteAccountFormType,
): Promise<{ success: boolean; error?: string }> {
  const validatedFields = deleteAccountSchema().safeParse(formData);

  if (!validatedFields.success) {
    return { success: false, error: "Invalid form data" };
  }

  const { currentPassword } = validatedFields.data;

  try {
    await auth.api.deleteUser({
      body: {
        password: currentPassword,
      },
      headers: await headers(),
    });
    return { success: true };
  } catch {
    return { success: false };
  }
}
