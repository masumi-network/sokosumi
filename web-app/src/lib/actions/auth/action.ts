"use server";

import { revalidatePath } from "next/cache";

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

export async function revalidateAppPath() {
  revalidatePath("/app");
}
