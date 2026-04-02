export const DEFAULT_TASK_ATTACHMENT_UPLOADING_FILE_TEMPLATE =
  "Uploading {fileName}";
export const DEFAULT_TASK_ATTACHMENT_UPLOADING_FILES_TEMPLATE =
  "Uploading {count} files";

interface RawTranslationReader {
  raw?: (key: string) => unknown;
}

export function getTaskAttachmentUploadLabelTemplate(
  translator: RawTranslationReader,
  key: "uploadingFile" | "uploadingFiles",
): string {
  const rawValue =
    typeof translator.raw === "function" ? translator.raw(key) : undefined;

  if (typeof rawValue === "string") {
    return rawValue;
  }

  if (key === "uploadingFile") {
    return DEFAULT_TASK_ATTACHMENT_UPLOADING_FILE_TEMPLATE;
  }

  return DEFAULT_TASK_ATTACHMENT_UPLOADING_FILES_TEMPLATE;
}
