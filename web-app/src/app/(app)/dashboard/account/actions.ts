"use server";

import { auth } from "@/lib/better-auth/auth";

import {
  DeleteAccountFormType,
  deleteAccountSchema,
  emailFormSchema,
  EmailFormType,
  passwordFormSchema,
  PasswordFormType,
} from "./data";

export async function updateEmail(formData: EmailFormType) {
  const validatedFields = emailFormSchema().safeParse(formData);

  if (!validatedFields.success) {
    return { error: "Invalid form data" };
  }

  const { email, currentPassword } = validatedFields.data;

  try {
    await auth.api.changeEmail({
      body: {
        newEmail: email,
        password: currentPassword,
        callbackURL: "/dashboard",
      },
    });
    return { success: true };
  } catch {
    return {
      error:
        "Failed to update email. Please check your password and try again.",
    };
  }
}

export async function updatePassword(formData: PasswordFormType) {
  const validatedFields = passwordFormSchema().safeParse(formData);

  if (!validatedFields.success) {
    return { error: "Invalid form data" };
  }

  const { currentPassword, newPassword } = validatedFields.data;

  try {
    await auth.api.changePassword({
      body: {
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      },
    });
    return { success: true };
  } catch {
    return {
      error:
        "Failed to update password. Please check your current password and try again.",
    };
  }
}

export async function deleteAccount(formData: DeleteAccountFormType) {
  const validatedFields = deleteAccountSchema().safeParse(formData);

  if (!validatedFields.success) {
    return { error: "Invalid form data" };
  }

  const { currentPassword } = validatedFields.data;

  try {
    await auth.api.deleteUser({
      body: {
        password: currentPassword,
      },
    });
    return { success: true };
  } catch {
    return {
      error:
        "Failed to delete account. Please check your password and try again.",
    };
  }
}
