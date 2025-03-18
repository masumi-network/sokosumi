"use server";
import { auth } from "@/lib/auth";

export async function signInSocial(provider: "google") {
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
