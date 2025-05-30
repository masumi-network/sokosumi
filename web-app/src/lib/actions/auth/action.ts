"use server";

import { auth } from "@/lib/auth/auth";

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
