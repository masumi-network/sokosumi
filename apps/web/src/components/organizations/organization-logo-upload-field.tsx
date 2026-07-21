"use client";

import { Building2, CloudUpload, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FileUpload, FileUploadTrigger } from "@/components/ui/file-upload";
import {
  ORGANIZATION_LOGO_ACCEPT,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
} from "@/lib/constants/organization-logo";

export interface OrganizationLogoUploadLabels {
  fileTooLarge: string;
  fileTypeNotAccepted: string;
  maxFilesExceeded: string;
  previewAlt: string;
  remove: string;
  replace: string;
  upload: string;
  uploadError: string;
}

interface OrganizationLogoUploadFieldProps {
  /** MIME accept list; defaults to organization logo types. */
  accept?: string;
  disabled: boolean;
  isRemoving?: boolean;
  isUploading: boolean;
  labels: OrganizationLogoUploadLabels;
  logoValue: string;
  /** Max bytes; defaults to organization logo limit. */
  maxSize?: number;
  onPendingLogoFilesChange: (files: File[]) => void;
  onRemove?: () => void;
  onUpload: (files: File[]) => void | Promise<void>;
  pendingLogoFiles: File[];
  showRemoveButton?: boolean;
}

function translateFileRejectMessage(
  message: string | undefined,
  labels: OrganizationLogoUploadLabels,
): string {
  if (message === "File too large") {
    return labels.fileTooLarge;
  }

  if (message === "File type not accepted") {
    return labels.fileTypeNotAccepted;
  }

  if (message?.startsWith("Maximum")) {
    return labels.maxFilesExceeded;
  }

  return message ?? labels.uploadError;
}

export function OrganizationLogoUploadField({
  accept = ORGANIZATION_LOGO_ACCEPT,
  disabled,
  isRemoving = false,
  isUploading,
  labels,
  logoValue,
  maxSize = ORGANIZATION_LOGO_MAX_SIZE_BYTES,
  onPendingLogoFilesChange,
  onRemove,
  onUpload,
  pendingLogoFiles,
  showRemoveButton = Boolean(logoValue),
}: OrganizationLogoUploadFieldProps) {
  return (
    <div className="max-w-24 space-y-3">
      <FileUpload
        value={pendingLogoFiles}
        onValueChange={onPendingLogoFilesChange}
        accept={accept}
        maxFiles={1}
        maxSize={maxSize}
        multiple={false}
        disabled={disabled}
        onAccept={onUpload}
        onFileReject={(_file, message) => {
          toast.error(translateFileRejectMessage(message, labels));
        }}
      >
        <div className="flex flex-col items-center gap-2">
          <FileUploadTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={logoValue ? labels.replace : labels.upload}
              className="group bg-muted focus-visible:ring-ring/60 relative size-24 cursor-pointer overflow-hidden rounded-lg border transition-opacity outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Avatar className="size-full rounded-none">
                <AvatarImage
                  src={logoValue || undefined}
                  alt={labels.previewAlt}
                  className="object-cover"
                />
                <AvatarFallback className="bg-muted text-muted-foreground rounded-none">
                  <Building2 className="size-8" />
                </AvatarFallback>
              </Avatar>
              <div
                className={`absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 px-2 text-white transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${
                  isUploading ? "opacity-100" : "opacity-0"
                }`}
              >
                {isUploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CloudUpload className="size-4" />
                )}
                <span className="text-center text-xs leading-tight">
                  {logoValue ? labels.replace : labels.upload}
                </span>
              </div>
            </button>
          </FileUploadTrigger>
          {showRemoveButton && onRemove ? (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              onClick={onRemove}
              className="size-8"
              aria-label={labels.remove}
              disabled={disabled}
            >
              {isRemoving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </Button>
          ) : null}
        </div>
      </FileUpload>
    </div>
  );
}
