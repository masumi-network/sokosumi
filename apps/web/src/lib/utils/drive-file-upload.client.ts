"use client";

import { resolveUserUploadContentType } from "@sokosumi/utils";
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

  // Resolve contentType (fallback when File.type is empty)
  const contentType = resolveUserUploadContentType(file.name, file.type);
  if (!contentType) {
    throw new Error("Unsupported file type");
  }

  // Mint upload session
  const mintResponse = await postDriveFiles({
    client: getBrowserCoreClient(),
    body: {
      filename: file.name,
      contentType,
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
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": headers["Content-Type"] ?? file.type,
    },
    body: file,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Blob upload failed with status ${uploadResponse.status}.`);
  }

  onUploadProgress?.({ percentage: 100 });
}

export function getDriveFileUploadErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Failed to upload file";
}
