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
      // Check for status in error or error.response
      const status =
        "status" in err
          ? (err.status as number)
          : "response" in err &&
              err.response &&
              typeof err.response === "object" &&
              "status" in err.response
            ? (err.response.status as number)
            : undefined;

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

  // Upload to Blob storage with XHR for progress tracking
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        const percentage = Math.round((event.loaded / event.total) * 100);
        onUploadProgress?.({ percentage });
      }
    });

    xhr.addEventListener("load", async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onUploadProgress?.({ percentage: 100 });
        resolve();
        return;
      }

      // Check for duplicate on Blob 409 or 400 with "already exists" message
      if (xhr.status === 409) {
        reject(
          new DriveFileUploadError(
            "duplicate",
            "A file with this name already exists",
          ),
        );
        return;
      }

      if (xhr.status === 400) {
        const bodyText = xhr.responseText;
        if (/already exists?/i.test(bodyText)) {
          reject(
            new DriveFileUploadError(
              "duplicate",
              "A file with this name already exists",
            ),
          );
          return;
        }
      }

      // All other Blob PUT failures are internal
      reject(
        new DriveFileUploadError(
          "internal",
          "Failed to upload file to storage",
        ),
      );
    });

    xhr.addEventListener("error", () => {
      reject(
        new DriveFileUploadError(
          "internal",
          "Failed to upload file to storage",
        ),
      );
    });

    xhr.addEventListener("abort", () => {
      reject(new DriveFileUploadError("internal", "Upload was aborted"));
    });

    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", headers["Content-Type"] ?? file.type);
    xhr.send(file);
  });
}
