"use client";

import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import { postDriveFiles } from "@/lib/clients/generated/core";

interface DriveFileUploadProgress {
  percentage: number;
}

interface DriveFileUploadOptions {
  scope: "me" | "org";
  organizationId?: string;
  onUploadProgress?: (progress: DriveFileUploadProgress) => void;
}

export async function uploadDriveFile(
  file: File,
  options: DriveFileUploadOptions,
): Promise<void> {
  const { scope, organizationId, onUploadProgress } = options;

  // Mint upload session
  const mintResponse = await postDriveFiles({
    client: getBrowserCoreClient(),
    body: {
      filename: file.name,
      contentType: file.type,
      size: file.size,
      scope,
      ...(scope === "org" && organizationId ? { organizationId } : {}),
    },
  });

  if (!mintResponse.data?.data) {
    throw new Error("Upload session missing data");
  }

  const session = mintResponse.data.data;
  const { uploadUrl, headers } = session;

  if (!uploadUrl) {
    throw new Error("Upload session missing uploadUrl");
  }

  // Upload to Blob storage
  await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": headers["Content-Type"] ?? file.type,
    },
    body: file,
  });

  onUploadProgress?.({ percentage: 100 });
}

export function getDriveFileUploadErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Failed to upload file";
}
