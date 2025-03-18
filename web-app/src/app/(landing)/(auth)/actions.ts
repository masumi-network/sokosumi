"use server";
import { auth } from "@/lib/auth";

export async function signInSocial(
  provider: "google" | "microsoft" | "apple" | "linkedin",
) {
  try {
    await auth.api.signInSocial({
      body: {
        provider: provider,
      },
    });
    return { success: true };
  } catch {
    return { error: "Failed to create account" };
  }
}
