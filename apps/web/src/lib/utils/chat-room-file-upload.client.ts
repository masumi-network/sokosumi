"use client";

import { resolveUserUploadContentType } from "@sokosumi/utils";
import {
  CoreApiRequestError,
  coreClient,
} from "@/lib/clients/core.browser.client";
import type { BlobFile } from "@/lib/clients/generated/core";
import {
  type UploadUserFileDirectOptions,
  UserFileUploadError,
  uploadViaPresignedUrl,
} from "@/lib/utils/user-file-upload.client";

export type UploadChatRoomFileDirectOptions = Pick<
  UploadUserFileDirectOptions,
  "abortSignal" | "onUploadProgress" | "maxSizeBytes" | "allowedContentTypes"
>;

function toChatRoomFileUploadError(error: unknown): UserFileUploadError {
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
        normalizedMessage.includes("unsupported")
      ) {
        return new UserFileUploadError(
          "unsupported_type",
          "File type is not accepted.",
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

  if (error instanceof Error && error.name === "AbortError") {
    return new UserFileUploadError("aborted", "Upload canceled.");
  }

  return new UserFileUploadError(
    "unknown",
    error instanceof Error ? error.message : "Failed to upload file.",
  );
}

/**
 * Mint a room-scoped chat file grant and PUT bytes to Blob.
 * No ChatFile row — callers put the public URL into message markdown.
 */
export async function uploadChatRoomFileDirect(
  roomId: string,
  file: File,
  options: UploadChatRoomFileDirectOptions = {},
): Promise<BlobFile> {
  if (!roomId) {
    throw new UserFileUploadError("invalid", "Room id is required.");
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

  try {
    const sessionBody: {
      filename: string;
      contentType: string;
      size: number;
    } = {
      filename: file.name,
      contentType,
      size: file.size,
    };

    const uploadSession = await coreClient.createChatRoomFileUploadSession(
      roomId,
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
    throw toChatRoomFileUploadError(error);
  }
}
