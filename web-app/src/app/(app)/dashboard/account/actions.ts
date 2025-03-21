"use server";

import { headers } from "next/headers";

import { auth } from "@/lib/better-auth/auth";

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

export async function updateName(formData: NameFormType): Promise<void> {
  const validatedFields = nameFormSchema.safeParse(formData);

  if (!validatedFields.success) {
    throw new Error("Invalid form data");
  }

  const { name, currentPassword } = validatedFields.data;

  await auth.api.updateUser({
    body: {
      name,
      password: currentPassword,
    },
    query: {
      disableCookieCache: true,
    },
    headers: await headers(),
  });
}

export async function updateEmail(formData: EmailFormType): Promise<void> {
  const validatedFields = emailFormSchema.safeParse(formData);

  if (!validatedFields.success) {
    throw new Error("Invalid form data");
  }

  const { email, currentPassword } = validatedFields.data;

  await auth.api.changeEmail({
    body: {
      newEmail: email,
      password: currentPassword,
      callbackURL: "/dashboard",
    },
    query: {
      disableCookieCache: true,
    },
    headers: await headers(),
  });
}

export async function updatePassword(
  formData: PasswordFormType,
): Promise<void> {
  const validatedFields = passwordFormSchema.safeParse(formData);

  if (!validatedFields.success) {
    throw new Error("Invalid form data");
  }

  const { currentPassword, newPassword } = validatedFields.data;

  await auth.api.changePassword({
    body: {
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    },
    query: {
      disableCookieCache: true,
    },
    headers: await headers(),
  });
}

export async function deleteAccount(
  formData: DeleteAccountFormType,
): Promise<void> {
  const validatedFields = deleteAccountSchema.safeParse(formData);

  if (!validatedFields.success) {
    throw new Error("Invalid form data");
  }

  const { currentPassword } = validatedFields.data;

  await auth.api.deleteUser({
    body: {
      password: currentPassword,
    },
    query: {
      disableCookieCache: true,
    },
    headers: await headers(),
  });
}
