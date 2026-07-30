import {
  resolveTaskFileContentType,
  TASK_FILE_MAX_SIZE_BYTES,
} from "@sokosumi/utils";
import {
  CoreApiRequestError,
  coreClient,
} from "@/lib/clients/core.browser.client";
import { formatBytes } from "@/lib/utils/format-bytes";
import {
  type UploadUserFileDirectOptions,
  UserFileUploadError,
  uploadViaPresignedUrl,
} from "@/lib/utils/user-file-upload.client";

export type UploadTaskAttachmentOptions = Pick<
  UploadUserFileDirectOptions,
  "abortSignal" | "onUploadProgress"
>;

function toTaskAttachmentUploadError(error: unknown): UserFileUploadError {
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

      return new UserFileUploadError(
        "too_large",
        error.message.includes("Maximum size")
          ? error.message
          : `File is too large. Maximum size is ${formatBytes(TASK_FILE_MAX_SIZE_BYTES)}.`,
      );
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
 * Mint a task-file grant and PUT bytes to Blob.
 * TaskFile row is created by Core's onUploadCompleted webhook; callers refresh.
 */
export async function uploadTaskAttachment(
  taskId: string,
  file: File,
  options: UploadTaskAttachmentOptions = {},
): Promise<string> {
  if (!taskId) {
    throw new UserFileUploadError(
      "invalid",
      "Save the task as a draft before attaching files.",
    );
  }

  if (!(file instanceof File) || file.size <= 0) {
    throw new UserFileUploadError("invalid", "File is required.");
  }

  if (file.size > TASK_FILE_MAX_SIZE_BYTES) {
    throw new UserFileUploadError(
      "too_large",
      `File is too large. Maximum size is ${formatBytes(TASK_FILE_MAX_SIZE_BYTES)}.`,
    );
  }

  const contentType = resolveTaskFileContentType(file.name, file.type);
  if (!contentType) {
    throw new UserFileUploadError(
      "unsupported_type",
      "File type could not be determined. Use a supported format or a file name with a known extension.",
    );
  }

  try {
    const uploadSession = await coreClient.createTaskFileUploadSession(taskId, {
      filename: file.name,
      contentType,
      size: file.size,
    });
    const session = uploadSession.data;

    if (!session.uploadUrl) {
      throw new UserFileUploadError(
        "unknown",
        "Upload session missing uploadUrl.",
      );
    }

    const uploaded = await uploadViaPresignedUrl(
      file,
      contentType,
      {
        uploadUrl: session.uploadUrl,
        pathname: session.pathname,
        headers: session.headers,
      },
      options,
    );

    return uploaded.publicUrl;
  } catch (error) {
    throw toTaskAttachmentUploadError(error);
  }
}
