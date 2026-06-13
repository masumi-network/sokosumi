"use server";

import { utmService } from "@/lib/services/utm.service";

export async function handleUtmConversion(): Promise<void> {
  try {
    await utmService.handleUTMConversion();
  } catch (error) {
    console.error("Failed to create utm attribution", error);
  }
}
