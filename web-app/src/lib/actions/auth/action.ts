"use server";

import { headers } from "next/headers";

import { auth, User } from "@/lib/auth/auth";

export async function signInSocial(
  provider: "google" | "microsoft" | "apple" | "linkedin",
): Promise<{ success: boolean; error?: string }> {
  try {
    await auth.api.signInSocial({
      body: {
        provider: provider,
      },
    });
    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function getAuthenticatedUser(): Promise<User | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return null;
  }

  return session.user;
}
