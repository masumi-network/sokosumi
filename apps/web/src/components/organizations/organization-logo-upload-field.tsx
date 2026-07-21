"use client";

import { Building2, CloudUpload, Loader2, X } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FileUpload, FileUploadTrigger } from "@/components/ui/file-upload";
import {
  ORGANIZATION_LOGO_ACCEPT,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
} from "@/lib/constants/organization-logo";
import { cn } from "@/lib/utils";

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
  /** Empty-state icon; defaults to Building2 for organization logos. */
  fallbackIcon?: ReactNode;
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
  fallbackIcon,
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
    <div className="max-w-24">
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
        <div className="relative size-24">
          <FileUploadTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={logoValue ? labels.replace : labels.upload}
              className="group bg-muted focus-visible:ring-ring/60 relative size-full cursor-pointer overflow-hidden rounded-lg border transition-opacity outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Avatar className="size-full rounded-none">
                <AvatarImage
                  src={logoValue || undefined}
                  alt={labels.previewAlt}
                  className="object-cover"
                />
                <AvatarFallback className="bg-muted text-muted-foreground rounded-none">
                  {fallbackIcon ?? <Building2 className="size-8" />}
                </AvatarFallback>
              </Avatar>
              <div
                className={cn(
                  "absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 px-2 text-white transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
                  isUploading ? "opacity-100" : "opacity-0",
                )}
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
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemove();
              }}
              aria-label={labels.remove}
              disabled={disabled || isRemoving}
              className={cn(
                "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                "focus-visible:ring-ring absolute -top-2 -right-2 z-10 flex size-6 items-center justify-center rounded-full border shadow-sm",
                "outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              {isRemoving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <X className="size-3.5" strokeWidth={2.5} />
              )}
            </button>
          ) : null}
        </div>
      </FileUpload>
    </div>
  );
}
