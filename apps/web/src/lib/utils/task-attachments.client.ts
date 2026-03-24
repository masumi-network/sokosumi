import { coreClient } from "@/lib/clients/core.browser.client";

export async function uploadTaskAttachment(file: File): Promise<string> {
  try {
    const response = await coreClient.uploadMyFile(file);
    const url = response.data.publicUrl;

    if (!url) {
      throw new Error("Failed to upload file");
    }

    return url;
  } catch {
    throw new Error("Failed to upload file");
  }
}
