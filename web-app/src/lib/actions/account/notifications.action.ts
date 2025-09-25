"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth/auth";

export async function setJobStatusEmailNotificationsEnabled(enabled: boolean) {
  try {
    await auth.api.updateUser({
      headers: await headers(),
      body: {
        jobStatusEmailNotificationsEnabled: enabled,
      },
    });
    revalidatePath("/account");
    return { success: true } as const;
  } catch (error) {
    console.error("Failed to update job status email notifications", error);
    return { success: false } as const;
  }
}
