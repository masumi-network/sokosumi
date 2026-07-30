import type { InputSchemaType } from "@sokosumi/masumi/schemas";
import { resolveUserUploadContentType } from "@sokosumi/utils";
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

interface BlobPutResponseBody {
  url?: string;
  pathname?: string;
  downloadUrl?: string;
  etag?: string;
}

function toBlobFileFromPut(
  file: File,
  blob: {
    url: string;
    pathname: string;
    downloadUrl: string;
    etag: string;
  },
): BlobFile {
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
}

async function uploadViaPresignedUrl(
  file: File,
  contentType: string,
  session: {
    uploadUrl: string;
    pathname: string;
    headers?: { "Content-Type"?: string };
  },
  options: UploadUserFileDirectOptions,
): Promise<BlobFile> {
  const headers = new Headers();
  headers.set("Content-Type", session.headers?.["Content-Type"] ?? contentType);

  const response = await fetch(session.uploadUrl, {
    method: "PUT",
    headers,
    body: file,
    signal: options.abortSignal,
  });

  if (!response.ok) {
    throw new UserFileUploadError(
      "unknown",
      `Blob upload failed with status ${response.status}.`,
    );
  }

  options.onUploadProgress?.({
    loaded: file.size,
    total: file.size,
    percentage: 100,
  });

  let body: BlobPutResponseBody = {};
  const responseType = response.headers.get("content-type") ?? "";
  if (responseType.includes("application/json")) {
    try {
      body = (await response.json()) as BlobPutResponseBody;
    } catch {
      body = {};
    }
  }

  const url = body.url;
  if (!url) {
    throw new UserFileUploadError(
      "unknown",
      "Blob upload succeeded but returned no public URL.",
    );
  }

  return toBlobFileFromPut(file, {
    url,
    pathname: body.pathname ?? session.pathname,
    downloadUrl: body.downloadUrl ?? url,
    etag: body.etag ?? response.headers.get("etag") ?? "",
  });
}

async function uploadViaClientToken(
  file: File,
  contentType: string,
  session: {
    pathname: string;
    access: "public";
    clientToken: string;
  },
  options: UploadUserFileDirectOptions,
): Promise<BlobFile> {
  const blob = await put(session.pathname, file, {
    access: session.access,
    token: session.clientToken,
    contentType,
    multipart: file.size > MULTIPART_UPLOAD_MIN_SIZE_BYTES,
    abortSignal: options.abortSignal,
    onUploadProgress: options.onUploadProgress,
  });

  return toBlobFileFromPut(file, {
    url: blob.url,
    pathname: blob.pathname,
    downloadUrl: blob.downloadUrl,
    etag: blob.etag,
  });
}

export async function uploadUserFileDirect(
  file: File,
  options: UploadUserFileDirectOptions = {},
): Promise<BlobFile> {
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
    const session = uploadSession.data;

    // Prefer REST presigned PUT (agent-compatible wire). Fall back to legacy
    // client-token `put` when progress callbacks need the Blob SDK.
    const needsSdkProgress = Boolean(options.onUploadProgress);
    if (session.uploadUrl && !needsSdkProgress) {
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
    }

    if (session.clientToken) {
      return await uploadViaClientToken(
        file,
        contentType,
        {
          pathname: session.pathname,
          access: session.access,
          clientToken: session.clientToken,
        },
        options,
      );
    }

    if (session.uploadUrl) {
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
    }

    throw new UserFileUploadError(
      "unknown",
      "Upload session missing uploadUrl and clientToken.",
    );
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
