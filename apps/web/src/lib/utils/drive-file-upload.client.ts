"use client";

import { resolveUserUploadContentType } from "@sokosumi/utils";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import { postDriveFiles } from "@/lib/clients/generated/core";

export type DriveFileUploadErrorCode = "duplicate" | "internal";

export class DriveFileUploadError extends Error {
  code: DriveFileUploadErrorCode;

  constructor(code: DriveFileUploadErrorCode, message: string) {
    super(message);
    this.name = "DriveFileUploadError";
    this.code = code;
  }
}

export function isDriveFileUploadDuplicate(
  error: unknown,
): error is DriveFileUploadError {
  return error instanceof DriveFileUploadError && error.code === "duplicate";
}

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
  let mintResponse;
  try {
    mintResponse = await postDriveFiles({
      client: getBrowserCoreClient(),
      body: {
        filename: file.name,
        contentType,
        size: file.size,
        scope,
        ...(scope === "org" && organizationId ? { organizationId } : {}),
      },
      throwOnError: true,
    });
  } catch (err: unknown) {
    // Detect mint 409 or "already exists" message
    if (err && typeof err === "object") {
      const status = "status" in err ? (err.status as number) : undefined;
      const message =
        "message" in err && typeof err.message === "string"
          ? err.message
          : undefined;

      if (status === 409) {
        throw new DriveFileUploadError(
          "duplicate",
          "A file with this name already exists",
        );
      }

      if (message && /already exists?/i.test(message)) {
        throw new DriveFileUploadError(
          "duplicate",
          "A file with this name already exists",
        );
      }
    }
    throw new DriveFileUploadError(
      "internal",
      "Failed to create upload session",
    );
  }

  if (!mintResponse.data?.data) {
    throw new DriveFileUploadError("internal", "Upload session missing data");
  }

  const session = mintResponse.data.data;
  const { uploadUrl, headers } = session;

  if (!uploadUrl) {
    throw new DriveFileUploadError(
      "internal",
      "Upload session missing uploadUrl",
    );
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
    const status = uploadResponse.status;

    // Check for duplicate on Blob 409 or 400 with "already exists" message
    if (status === 409) {
      throw new DriveFileUploadError(
        "duplicate",
        "A file with this name already exists",
      );
    }

    if (status === 400) {
      try {
        const bodyText = await uploadResponse.text();
        if (/already exists?/i.test(bodyText)) {
          throw new DriveFileUploadError(
            "duplicate",
            "A file with this name already exists",
          );
        }
      } catch (parseErr) {
        // If DriveFileUploadError, rethrow it
        if (parseErr instanceof DriveFileUploadError) {
          throw parseErr;
        }
        // Otherwise, treat as internal error and fall through
      }
    }

    // All other Blob PUT failures are internal
    throw new DriveFileUploadError(
      "internal",
      "Failed to upload file to storage",
    );
  }

  onUploadProgress?.({ percentage: 100 });
}
