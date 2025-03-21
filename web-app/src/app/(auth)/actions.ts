"use server";
import { auth } from "@/lib/better-auth/auth";

export async function signInSocial(
  provider: "google" | "microsoft" | "apple" | "linkedin",
) {
  await auth.api.signInSocial({
    body: {
      provider: provider,
    },
  });
}
