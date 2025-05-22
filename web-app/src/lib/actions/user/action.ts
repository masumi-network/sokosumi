"use server";

import { setUserMarketingOptIn } from "@/lib/db/user/repo";

export interface UpdateUserMarketingOptInResult {
  success: boolean;
  error?: string;
}

export async function updateUserMarketingOptIn(
  userId: string,
  marketingOptIn: boolean,
): Promise<UpdateUserMarketingOptInResult> {
  try {
    await setUserMarketingOptIn(userId, marketingOptIn);
    return { success: true };
  } catch (error) {
    console.error("Error updating marketing opt-in status:", error);
    return { success: false, error: "Failed to update marketing preference" };
  }
}
