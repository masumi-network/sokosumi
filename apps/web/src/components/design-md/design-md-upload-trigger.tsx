"use client";

import { CloudUpload, FileText, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import { saveDesignMdUpload } from "@/lib/actions/design-md";
import type { PersistedDesignMd } from "@/lib/services/design-md.service";
import { formatBytes } from "@/lib/utils/format-bytes";

import {
  DESIGN_MD_TRANSLATION_NAMESPACE,
  type ManageableDesignMdOwner,
} from "./types";

const DESIGN_MD_ACCEPT = ".md,.markdown,text/markdown,text/plain";
const DESIGN_MD_MAX_SIZE_BYTES = 1024 * 1024;

interface DesignMdUploadTriggerProps {
  disabled?: boolean;
  onSaved?: (designMd: PersistedDesignMd) => void;
  owner: ManageableDesignMdOwner;
  variant?: "compact" | "default";
}

export function DesignMdUploadTrigger({
  disabled = false,
  onSaved,
  owner,
  variant = "default",
}: DesignMdUploadTriggerProps) {
  const t = useTranslations(DESIGN_MD_TRANSLATION_NAMESPACE);
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = useCallback(
    async (
      acceptedFiles: File[],
      options: {
        onError: (file: File, error: Error) => void;
        onSuccess: (file: File) => void;
      },
    ) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setIsUploading(true);
      try {
        const content = await file.text();
        const result = await saveDesignMdUpload({ owner, content });

        if (!result.ok) {
          throw new Error(result.error.message ?? t("uploadError"));
        }

        options.onSuccess(file);
        onSaved?.(result.value);
        setFiles([]);
        toast.success(t("uploadSuccess"));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t("uploadError");
        options.onError(file, new Error(message));
        toast.error(message);
      } finally {
        setIsUploading(false);
      }
    },
    [onSaved, owner, t],
  );

  const handleReject = useCallback(
    (_file: File, message: string) => {
      toast.error(message || t("uploadRejected"));
    },
    [t],
  );

  const isDisabled = disabled || isUploading;
  const uploadDescription = t("uploadDescription", {
    maxSize: formatBytes(DESIGN_MD_MAX_SIZE_BYTES),
  });

  return (
    <FileUpload
      value={files}
      onValueChange={setFiles}
      accept={DESIGN_MD_ACCEPT}
      disabled={isDisabled}
      label={t("uploadLabel")}
      maxFiles={1}
      maxSize={DESIGN_MD_MAX_SIZE_BYTES}
      onFileReject={handleReject}
      onUpload={handleUpload}
    >
      {files.length === 0 ? (
        <FileUploadDropzone
          className={
            variant === "compact"
              ? "items-start p-3 text-left"
              : "items-start p-4 text-left"
          }
        >
          {variant === "compact" ? (
            <div className="flex w-full items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent">
                <FileText className="size-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium text-sm">{t("uploadTitle")}</p>
                <p className="text-muted-foreground text-sm">
                  {uploadDescription}
                </p>
              </div>
              <FileUploadTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isDisabled}
                  className="shrink-0"
                >
                  <CloudUpload className="size-4" />
                  {isUploading ? t("uploading") : t("uploadButton")}
                </Button>
              </FileUploadTrigger>
            </div>
          ) : (
            <div className="flex w-full items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent">
                <FileText className="size-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium text-sm">{t("uploadTitle")}</p>
                <p className="text-muted-foreground text-sm">
                  {uploadDescription}
                </p>
                <FileUploadTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isDisabled}
                    className="mt-2"
                  >
                    <CloudUpload className="size-4" />
                    {isUploading ? t("uploading") : t("uploadButton")}
                  </Button>
                </FileUploadTrigger>
              </div>
            </div>
          )}
        </FileUploadDropzone>
      ) : null}
      <FileUploadList>
        {files.map((file) => (
          <FileUploadItem
            key={`${file.name}-${file.lastModified}`}
            value={file}
          >
            <FileUploadItemPreview />
            <FileUploadItemMetadata />
            {!isDisabled ? (
              <FileUploadItemDelete asChild>
                <Button type="button" variant="ghost" size="icon">
                  <X className="size-4" />
                  <span className="sr-only">{t("removeSelectedUpload")}</span>
                </Button>
              </FileUploadItemDelete>
            ) : null}
          </FileUploadItem>
        ))}
      </FileUploadList>
    </FileUpload>
  );
}
