"use client";

import { postDriveFiles, postDriveFilesFinalize } from "@sokosumi/core-client";
import { resolveUserUploadContentType } from "@sokosumi/utils";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type { DriveWorkspaceStore } from "@/lib/utils/drive-file-list.client";

export type DriveFileUploadErrorCode = "duplicate" | "internal";

const XHR_UPLOAD_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

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

/**
 * Detect 409 Conflict or "already exists" message in error responses.
 * Shared predicate for both file upload mint and folder create duplicate detection.
 */
export function isDuplicateResourceError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  // Check for status in error or error.response
  const status =
    "status" in error
      ? (error.status as number)
      : "response" in error &&
          error.response &&
          typeof error.response === "object" &&
          "status" in error.response
        ? (error.response.status as number)
        : undefined;

  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : undefined;

  // HTTP 409 = Conflict (duplicate or reserved resource)
  if (status === 409) {
    return true;
  }

  // Check message for duplicate/reserved/conflict patterns
  if (message) {
    const duplicatePatterns = [
      /already exists?/i,
      /is reserved/i,
      /conflict/i,
      /duplicate/i,
    ];
    if (duplicatePatterns.some((pattern) => pattern.test(message))) {
      return true;
    }
  }

  return false;
}

interface DriveFileUploadProgress {
  percentage: number;
}

/**
 * Stored Drive file: pathname is the Core identity, fileUrl the public Blob
 * URL (null inside a data room, or when the released flow's PUT carried none).
 */
export interface DriveFileUploadResult {
  pathname: string;
  fileUrl: string | null;
  resourceId?: string;
}

type DriveFileUploadOptions = DriveWorkspaceStore & {
  folder?: string;
  /** Make a copy: a new personal file no model labels (409 if the name is held). */
  pinLabelsEmpty?: boolean;
  /** Skip staging: the fallback when a staged session cannot be finalized. */
  released?: boolean;
  onUploadProgress?: (progress: DriveFileUploadProgress) => void;
};

/** Public Blob URL from the presigned PUT response, or null when absent. */
function parseUploadedBlobUrl(responseText: string): string | null {
  try {
    const body = JSON.parse(responseText) as { url?: unknown };
    if (typeof body.url === "string" && body.url) {
      return body.url;
    }
  } catch {
    // Fall through to null: caller reports the missing URL.
  }
  return null;
}

export async function uploadDriveFile(
  file: File,
  options: DriveFileUploadOptions,
): Promise<DriveFileUploadResult> {
  const { scope, folder, onUploadProgress } = options;

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
        ...(scope === "org" ? { organizationId: options.organizationId } : {}),
        ...(folder ? { folder } : {}),
        ...(options.pinLabelsEmpty ? { pinLabelsEmpty: true } : {}),
        // A Core that predates staging ignores this and answers with a
        // released session (no attemptId), which is handled below.
        ...(options.released ? {} : { staged: true }),
      },
      // Not thrown: the thrown error is the response body, which drops the
      // HTTP status that says "this name is taken".
      throwOnError: false,
    });
  } catch (err: unknown) {
    // Detect mint 409 or "already exists" message
    if (isDuplicateResourceError(err)) {
      throw new DriveFileUploadError(
        "duplicate",
        "A file with this name already exists",
      );
    }
    throw new DriveFileUploadError(
      "internal",
      "Failed to create upload session",
    );
  }

  if (mintResponse.error) {
    if (mintResponse.response?.status === 409) {
      throw new DriveFileUploadError(
        "duplicate",
        "A file with this name already exists",
      );
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
  const { uploadUrl, headers, attemptId } = session;

  // A copy's free labelling rests on staging: a Core that answered with a
  // released session would label it like any upload, so it is never sent.
  if (options.pinLabelsEmpty && !attemptId) {
    throw new DriveFileUploadError(
      "internal",
      "Making a copy is not available yet",
    );
  }

  if (!uploadUrl) {
    throw new DriveFileUploadError(
      "internal",
      "Upload session missing uploadUrl",
    );
  }

  // Upload to Blob storage with XHR for progress tracking
  return await new Promise<DriveFileUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let hasRealProgress = false;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;
    let fallbackProgress = 0;

    // Fallback progress estimator if lengthComputable is false or no events fire
    const startFallbackProgress = () => {
      fallbackInterval = setInterval(() => {
        if (!hasRealProgress && fallbackProgress < 90) {
          fallbackProgress = Math.min(fallbackProgress + 10, 90);
          onUploadProgress?.({ percentage: fallbackProgress });
        }
      }, 1000);
    };

    const stopFallbackProgress = () => {
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        hasRealProgress = true;
        stopFallbackProgress();
        const percentage = Math.round((event.loaded / event.total) * 100);
        onUploadProgress?.({ percentage });
      }
    });

    xhr.addEventListener("load", async () => {
      stopFallbackProgress();
      if (xhr.status >= 200 && xhr.status < 300) {
        onUploadProgress?.({ percentage: 100 });
        const finalize = () =>
          postDriveFilesFinalize({
            client: getBrowserCoreClient(),
            body: {
              scope,
              ...(scope === "org"
                ? { organizationId: options.organizationId }
                : {}),
              pathname: session.pathname,
              ...(attemptId ? { attemptId } : {}),
            },
            throwOnError: true,
          });

        if (attemptId) {
          // Staged: the PUT wrote this attempt's staging key, so the file is
          // in Drive only once finalize has moved it. A finalize that fails
          // twice fails the upload, and only finalize knows the file's URL.
          try {
            const finalized = await finalize().catch(finalize);
            resolve({
              pathname: session.pathname,
              fileUrl: finalized.data.data.fileUrl,
              resourceId: finalized.data.data.resourceId,
            });
          } catch {
            // A Core rolled back to before staging cannot publish this
            // attempt: upload once more the released way. Never for a copy,
            // which would then be labelled like any upload.
            if (!options.pinLabelsEmpty && !options.released) {
              uploadDriveFile(file, { ...options, released: true }).then(
                resolve,
                reject,
              );
              return;
            }
            reject(
              new DriveFileUploadError(
                "internal",
                "Failed to save the uploaded file",
              ),
            );
          }
          return;
        }

        // The bytes went client → Blob, so Core never saw them land. Tell it,
        // so the file gets a catalog identity and starts being indexed. A
        // failure here does not fail the upload: the file is on disk, and the
        // next search adopts it.
        let resourceId: string | undefined;
        try {
          const finalized = await finalize();
          resourceId = finalized.data?.data.resourceId;
        } catch {
          // Intentionally quiet: indexing catches up on its own.
        }
        // Resolving with the blob's location is main's shape, kept: the
        // finalize above is an extra step on the way out, not a change to
        // what the caller is handed for locating the blob. Consumers that
        // need a catalog entry can use the optional id from finalization.
        resolve({
          pathname: session.pathname,
          fileUrl: parseUploadedBlobUrl(xhr.responseText),
          ...(resourceId ? { resourceId } : {}),
        });
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
      stopFallbackProgress();
      reject(
        new DriveFileUploadError(
          "internal",
          "Failed to upload file to storage",
        ),
      );
    });

    xhr.addEventListener("abort", () => {
      stopFallbackProgress();
      reject(new DriveFileUploadError("internal", "Upload was aborted"));
    });

    xhr.addEventListener("timeout", () => {
      stopFallbackProgress();
      reject(
        new DriveFileUploadError(
          "internal",
          "Upload timed out after 2 minutes",
        ),
      );
    });

    try {
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader(
        "Content-Type",
        headers?.["Content-Type"] ?? contentType,
      );
      xhr.timeout = XHR_UPLOAD_TIMEOUT_MS;

      // Start fallback progress estimator
      startFallbackProgress();

      xhr.send(file);
    } catch (_err) {
      stopFallbackProgress();
      reject(
        new DriveFileUploadError(
          "internal",
          "Failed to initiate upload request",
        ),
      );
    }
  });
}
