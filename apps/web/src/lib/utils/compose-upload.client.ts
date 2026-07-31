"use client";

import { resolveUserUploadContentType } from "@sokosumi/utils";
import { toast } from "sonner";
import {
  createFileUploadProgressToast,
  type FileUploadProgressToastLabels,
} from "@/lib/utils/file-upload-progress-toast";
import { sanitizeTaskAttachmentLabel } from "@/lib/utils/task-attachments";
import {
  getUserFileUploadErrorMessage,
  type UploadUserFileDirectOptions,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";

export interface ComposeUploadLabels extends FileUploadProgressToastLabels {
  uploadError: string;
}

export interface ComposeUploadResult {
  publicUrl: string;
  fileName: string;
  mediaType: string | null;
  file: File;
}

export interface UploadComposeAttachmentsOptions {
  labels: ComposeUploadLabels;
  abortSignal?: AbortSignal;
  allowedContentTypes?: UploadUserFileDirectOptions["allowedContentTypes"];
  maxSizeBytes?: UploadUserFileDirectOptions["maxSizeBytes"];
  fallbackFileName?: string;
}

/**
 * Shared compose attach helper: progress toast + error toast → public URLs.
 * Backing mint is `uploadUserFileDirect` (user-owned blobs). Callers insert
 * URLs into markdown/message content. No parent file row is created.
 */
export async function uploadComposeAttachments(
  files: File[],
  options: UploadComposeAttachmentsOptions,
): Promise<ComposeUploadResult[]> {
  if (files.length === 0) {
    return [];
  }

  const uploadToast = createFileUploadProgressToast({
    files,
    labels: {
      uploadingFile: options.labels.uploadingFile,
      uploadingFiles: options.labels.uploadingFiles,
    },
  });

  try {
    const results: ComposeUploadResult[] = [];

    for (const [index, file] of files.entries()) {
      const uploaded = await uploadUserFileDirect(file, {
        abortSignal: options.abortSignal,
        allowedContentTypes: options.allowedContentTypes,
        maxSizeBytes: options.maxSizeBytes,
        onUploadProgress: (progress) => {
          uploadToast.updateFileProgress(index, progress);
        },
      });
      uploadToast.markFileComplete(index);

      const resolvedMediaType =
        resolveUserUploadContentType(file.name, file.type) ??
        (file.type || null);

      results.push({
        publicUrl: uploaded.publicUrl,
        fileName: sanitizeTaskAttachmentLabel(
          file.name,
          options.fallbackFileName ?? "file",
        ),
        mediaType: resolvedMediaType,
        file,
      });
    }

    uploadToast.dismiss();
    return results;
  } catch (error) {
    uploadToast.dismiss();
    toast.error(
      getUserFileUploadErrorMessage(error, options.labels.uploadError),
    );
    throw error;
  }
}
