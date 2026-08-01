import { resolveUserUploadContentType } from "@sokosumi/utils";

import {
  CoreApiRequestError,
  coreClient,
} from "@/lib/clients/core.browser.client";
import type { BlobFile } from "@/lib/clients/generated/core";
import { formatBytes } from "@/lib/utils/format-bytes";
import {
  type UploadUserFileDirectOptions,
  UserFileUploadError,
  uploadViaPresignedUrl,
} from "@/lib/utils/user-file-upload.client";

export {
  getUserFileUploadErrorMessage as getVendorLogoUploadErrorMessage,
  UserFileUploadError,
} from "@/lib/utils/user-file-upload.client";
export type { UploadUserFileDirectOptions as UploadVendorLogoDirectOptions };

function extractMaxSizeFromMessage(message: string): number | null {
  const matches = message.match(/\b\d{4,}\b/g);
  if (!matches) {
    return null;
  }

  const maxSize = matches.map(Number).find((value) => value > 1024);
  return maxSize ?? null;
}

function toVendorLogoUploadError(error: unknown): UserFileUploadError {
  if (error instanceof UserFileUploadError) {
    return error;
  }

  if (error instanceof CoreApiRequestError) {
    const normalizedMessage = error.message.toLowerCase();

    if (error.status === 401 || error.status === 403) {
      return new UserFileUploadError(
        "unauthorized",
        "You need to sign in before uploading files.",
      );
    }

    if (error.status === 400 || error.status === 413 || error.status === 422) {
      if (
        normalizedMessage.includes("content type") ||
        normalizedMessage.includes("allowedcontenttypes") ||
        normalizedMessage.includes("unsupported content types")
      ) {
        return new UserFileUploadError(
          "unsupported_type",
          "File type is not accepted.",
        );
      }

      const maxSize = extractMaxSizeFromMessage(error.message);
      if (maxSize !== null) {
        return new UserFileUploadError(
          "too_large",
          `File is too large. Maximum size is ${formatBytes(maxSize)}.`,
        );
      }

      return new UserFileUploadError("too_large", error.message);
    }

    if (error.status === 503) {
      return new UserFileUploadError(
        "network",
        "Upload service is currently unavailable. Please try again.",
      );
    }

    return new UserFileUploadError("unknown", error.message);
  }

  if (!(error instanceof Error)) {
    return new UserFileUploadError("unknown", "Failed to upload file.");
  }

  if (error.name === "AbortError") {
    return new UserFileUploadError("aborted", "Upload canceled.");
  }

  if (error.name === "TimeoutError" || error.name === "TypeError") {
    return new UserFileUploadError(
      "network",
      "Network error while uploading file. Please try again.",
    );
  }

  return new UserFileUploadError("unknown", error.message);
}

/**
 * Mint a vendor-scoped logo upload session and PUT the file via the presigned URL.
 * Requires a non-empty vendorId — never mint under the user prefix.
 */
export async function uploadVendorLogoDirect(
  vendorId: string,
  file: File,
  options: UploadUserFileDirectOptions = {},
): Promise<BlobFile> {
  if (!vendorId.trim()) {
    throw new UserFileUploadError(
      "invalid",
      "Vendor id is required to upload a logo.",
    );
  }

  if (!(file instanceof File) || file.size <= 0) {
    throw new UserFileUploadError("invalid", "File is required.");
  }

  const contentType = resolveUserUploadContentType(file.name, file.type);
  if (!contentType) {
    throw new UserFileUploadError(
      "unsupported_type",
      "File type could not be determined. Use a supported format or a file name with a known extension.",
    );
  }

  if (
    options.allowedContentTypes &&
    !options.allowedContentTypes.includes(contentType)
  ) {
    throw new UserFileUploadError(
      "unsupported_type",
      "File type is not accepted.",
    );
  }

  if (options.maxSizeBytes !== undefined && file.size > options.maxSizeBytes) {
    throw new UserFileUploadError(
      "too_large",
      `File is too large. Maximum size is ${formatBytes(options.maxSizeBytes)}.`,
    );
  }

  try {
    const sessionBody: {
      filename: string;
      contentType: string;
      size: number;
      maxSizeBytes?: number;
    } = {
      filename: file.name,
      contentType,
      size: file.size,
    };
    if (options.maxSizeBytes !== undefined) {
      sessionBody.maxSizeBytes = options.maxSizeBytes;
    }

    const uploadSession = await coreClient.createVendorLogoUploadSession(
      vendorId,
      sessionBody,
    );
    const session = uploadSession.data;

    if (!session.uploadUrl) {
      throw new UserFileUploadError(
        "unknown",
        "Upload session missing uploadUrl.",
      );
    }

    return await uploadViaPresignedUrl(
      file,
      contentType,
      {
        uploadUrl: session.uploadUrl,
        pathname: session.pathname,
        headers: session.headers,
      },
      options,
    );
  } catch (error) {
    throw toVendorLogoUploadError(error);
  }
}

/**
 * Best-effort delete of a prior vendor-owned logo blob. Soft-fails on any error.
 */
export async function cleanupVendorLogoBestEffort(
  vendorId: string,
  previousLogoUrl: string | null | undefined,
): Promise<void> {
  const trimmedVendorId = vendorId.trim();
  const trimmedUrl = previousLogoUrl?.trim();
  if (!trimmedVendorId || !trimmedUrl) {
    return;
  }

  try {
    await coreClient.cleanupVendorLogo(trimmedVendorId, {
      url: trimmedUrl,
    });
  } catch (error) {
    console.error("Failed to cleanup previous vendor logo", error);
  }
}
