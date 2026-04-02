import type { InputSchemaType } from "@sokosumi/masumi/schemas";
import { put } from "@vercel/blob/client";
import {
  CoreApiRequestError,
  coreClient,
} from "@/lib/clients/core.browser.client";
import type { BlobFile } from "@/lib/clients/generated/core";
import { formatBytes } from "@/lib/utils/format-bytes";

const MULTIPART_UPLOAD_MIN_SIZE_BYTES = 5 * 1024 * 1024;

export type UserFileUploadErrorCode =
  | "invalid"
  | "too_large"
  | "unauthorized"
  | "unsupported_type"
  | "aborted"
  | "network"
  | "unknown";

export class UserFileUploadError extends Error {
  code: UserFileUploadErrorCode;

  constructor(code: UserFileUploadErrorCode, message: string) {
    super(message);
    this.name = "UserFileUploadError";
    this.code = code;
  }
}

export interface UserFileUploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface UploadUserFileDirectOptions {
  abortSignal?: AbortSignal;
  onUploadProgress?: (progress: UserFileUploadProgress) => void;
  allowedContentTypes?: readonly string[];
  maxSizeBytes?: number;
}

function extractMaxSizeFromMessage(message: string): number | null {
  const matches = message.match(/\b\d{4,}\b/g);
  if (!matches) {
    return null;
  }

  const maxSize = matches.map(Number).find((value) => value > 1024);
  return maxSize ?? null;
}

function isBlobAbortMessage(message: string): boolean {
  return message.toLowerCase().includes("request was aborted");
}

function toUserFileUploadError(error: unknown): UserFileUploadError {
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

  if (error.name === "BlobFileTooLargeError") {
    return new UserFileUploadError("too_large", "File is too large.");
  }

  if (error.name === "BlobContentTypeNotAllowedError") {
    return new UserFileUploadError(
      "unsupported_type",
      "File type is not accepted.",
    );
  }

  if (
    error.name === "AbortError" ||
    error.name === "BlobRequestAbortedError" ||
    isBlobAbortMessage(error.message)
  ) {
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

export function getUserFileUploadErrorMessage(
  error: unknown,
  fallbackMessage: string = "Failed to upload file.",
): string {
  const typedError = toUserFileUploadError(error);

  return typedError.message || fallbackMessage;
}

export async function uploadUserFileDirect(
  file: File,
  options: UploadUserFileDirectOptions = {},
): Promise<BlobFile> {
  if (!(file instanceof File) || file.size <= 0) {
    throw new UserFileUploadError("invalid", "File is required.");
  }

  const contentType = file.type || "application/octet-stream";

  try {
    const sessionBody: {
      filename: string;
      contentType: string;
      size: number;
      allowedContentTypes?: string[];
      maxSizeBytes?: number;
    } = {
      filename: file.name,
      contentType,
      size: file.size,
    };
    if (options.allowedContentTypes) {
      sessionBody.allowedContentTypes = [...options.allowedContentTypes];
    }
    if (options.maxSizeBytes !== undefined) {
      sessionBody.maxSizeBytes = options.maxSizeBytes;
    }

    const uploadSession =
      await coreClient.createMyFileUploadSession(sessionBody);
    const blob = await put(uploadSession.data.pathname, file, {
      access: uploadSession.data.access,
      token: uploadSession.data.clientToken,
      contentType,
      multipart: file.size > MULTIPART_UPLOAD_MIN_SIZE_BYTES,
      abortSignal: options.abortSignal,
      onUploadProgress: options.onUploadProgress,
    });

    return {
      publicUrl: blob.url,
      metadata: {
        pathname: blob.pathname,
        downloadUrl: blob.downloadUrl,
        size: file.size,
        uploadedAt: new Date(),
        etag: blob.etag,
      },
    };
  } catch (error) {
    throw toUserFileUploadError(error);
  }
}

export async function uploadInputDataFiles(
  inputData: InputSchemaType,
): Promise<void> {
  for (const [key, value] of Object.entries(inputData)) {
    if (value instanceof File) {
      const uploaded = await uploadUserFileDirect(value);
      inputData[key] = uploaded.publicUrl;
      continue;
    }

    if (!Array.isArray(value) || !value.every((item) => item instanceof File)) {
      continue;
    }

    const uploadedFiles = await Promise.all(
      value.map(async (file: File) => {
        const uploaded = await uploadUserFileDirect(file);
        return uploaded.publicUrl;
      }),
    );

    inputData[key] =
      uploadedFiles.length === 1 ? uploadedFiles[0] : uploadedFiles;
  }
}
