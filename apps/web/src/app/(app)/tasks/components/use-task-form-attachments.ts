"use client";

import { formatTaskAttachmentMarkdown } from "@sokosumi/utils";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { uploadComposeAttachments } from "@/lib/utils/compose-upload.client";
import {
  extractTaskAttachmentUrls,
  removeTaskAttachmentLinks,
} from "@/lib/utils/task-attachments";
import { type MarkdownEditorHandle } from "./markdown-editor";

import type { TaskFormLabels } from "./task-form-types";
export function useTaskFormAttachments(
  description: string,
  setDescription: Dispatch<SetStateAction<string>>,
  labels: TaskFormLabels,
) {
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [uploadingAttachmentsCount, setUploadingAttachmentsCount] = useState(0);
  const markdownEditorRef = useRef<MarkdownEditorHandle>(null);
  const attachmentTriggerRef = useRef<HTMLButtonElement>(null);
  const activeUploadControllersRef = useRef(new Set<AbortController>());
  const attachmentUrls = useMemo(
    () => extractTaskAttachmentUrls(description),
    [description],
  );
  const abortActiveUploads = useCallback(() => {
    for (const controller of activeUploadControllersRef.current) {
      controller.abort();
    }
    activeUploadControllersRef.current.clear();
  }, []);

  useEffect(() => abortActiveUploads, [abortActiveUploads]);

  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const controller = new AbortController();
      activeUploadControllersRef.current.add(controller);
      setUploadingAttachmentsCount((count) => count + 1);
      try {
        const uploaded = await uploadComposeAttachments(files, {
          abortSignal: controller.signal,
          labels: {
            uploadingFile: labels.uploadingFile,
            uploadingFiles: labels.uploadingFiles,
            uploadError: labels.uploadFileError ?? "Failed to upload file",
          },
        });
        for (const result of uploaded) {
          if (markdownEditorRef.current) {
            markdownEditorRef.current.insertLink(
              result.fileName,
              result.publicUrl,
            );
            markdownEditorRef.current.insertText("\n");
            continue;
          }
          const markdownLink = formatTaskAttachmentMarkdown(
            result.fileName,
            result.publicUrl,
          );
          setDescription(
            (prev) =>
              `${prev}${prev.endsWith("\n") ? "" : "\n"}${markdownLink}`,
          );
        }
      } catch {
        // Error toast is handled by uploadComposeAttachments.
      } finally {
        activeUploadControllersRef.current.delete(controller);
        setPendingUploadFiles([]);
        setUploadingAttachmentsCount((count) => count - 1);
      }
    },
    [labels.uploadFileError, labels.uploadingFile, labels.uploadingFiles],
  );

  const handleRemoveAttachment = useCallback((url: string) => {
    setDescription((prev) => removeTaskAttachmentLinks(prev, [url]));
  }, []);

  return {
    pendingUploadFiles,
    setPendingUploadFiles,
    uploadingAttachmentsCount,
    markdownEditorRef,
    attachmentTriggerRef,
    attachmentUrls,
    abortActiveUploads,
    handleAttachFiles,
    handleRemoveAttachment,
  };
}
