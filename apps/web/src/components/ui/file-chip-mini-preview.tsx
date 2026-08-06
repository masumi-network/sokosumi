"use client";

import { getExtensionFromUrl } from "@sokosumi/utils";
import { X } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { DocumentViewer } from "@/components/ui/document-viewer";
import { FileChip } from "@/components/ui/file-chip";
import { FileTypeIcon } from "@/components/ui/file-icon";
import { ImageViewer } from "@/components/ui/image-viewer";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { classifyFilePreview } from "@/lib/utils/file-preview";
import { formatBytes } from "@/lib/utils/format-bytes";

export type FileChipMiniPreviewVariant = "thumb" | "large";

export interface FileChipMiniPreviewProps {
  url: string;
  fileName?: string | null;
  mediaType?: string | null;
  size?: number | bigint | null;
  className?: string;
  sizeClass?: string;
  variant?: FileChipMiniPreviewVariant;
  onRemove?: () => void;
  removeLabel?: string;
}

const previewTriggerClassName =
  "group bg-accent/30 hover:bg-accent/50 focus-visible:ring-ring relative block shrink-0 cursor-pointer overflow-hidden rounded-xl border outline-none transition";

const largeImageTriggerClassName =
  "min-w-0 max-h-80 w-full max-w-full shrink";

function FileChipMiniPreviewTrigger({
  url,
  fileName,
  mediaType,
  sizeClass,
  variant,
  onOpenImage,
  onOpenDocument,
}: {
  url: string;
  fileName?: string | null;
  mediaType?: string | null;
  sizeClass: string;
  variant: FileChipMiniPreviewVariant;
  onOpenImage: () => void;
  onOpenDocument: () => void;
}) {
  const t = useTranslations("Components.ImageViewer");
  const tDocument = useTranslations("Components.DocumentViewer");
  const resolvedFileName = fileName ?? url.split("/").pop() ?? url;
  const { isImage, documentKind } = classifyFilePreview(
    url,
    fileName,
    mediaType,
  );
  const extension = getExtensionFromUrl(fileName ?? url);
  const useLargeImage = variant === "large" && isImage;

  if (isImage) {
    if (useLargeImage) {
      return (
        <button
          type="button"
          aria-label={t("viewImage", { fileName: resolvedFileName })}
          className={cn(previewTriggerClassName, largeImageTriggerClassName)}
          onClick={onOpenImage}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={resolvedFileName}
            className="max-h-80 w-full max-w-full object-contain object-center"
          />
        </button>
      );
    }

    return (
      <button
        type="button"
        aria-label={t("viewImage", { fileName: resolvedFileName })}
        className={cn(previewTriggerClassName, sizeClass)}
        onClick={onOpenImage}
      >
        <div className="relative size-full overflow-hidden">
          <Image
            src={url}
            alt={resolvedFileName}
            fill
            sizes="96px"
            className="object-cover object-center"
          />
        </div>
      </button>
    );
  }

  if (documentKind) {
    return (
      <button
        type="button"
        aria-label={tDocument("viewDocument", { fileName: resolvedFileName })}
        className={cn(previewTriggerClassName, sizeClass)}
        onClick={onOpenDocument}
      >
        <div className="text-muted-foreground flex size-full items-center justify-center">
          <div className="flex size-8 items-center justify-center rounded-md">
            <FileTypeIcon extension={extension || "file"} />
          </div>
        </div>
      </button>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(previewTriggerClassName, sizeClass)}
    >
      <div className="text-muted-foreground flex size-full items-center justify-center">
        <div className="flex size-8 items-center justify-center rounded-md">
          <FileTypeIcon extension={extension || "file"} />
        </div>
      </div>
    </a>
  );
}

function FileChipMiniPreviewShell({
  url,
  fileName,
  mediaType,
  className,
  sizeClass = "size-20",
  variant = "thumb",
  onRemove,
  removeLabel = "Remove file",
  wrapTrigger,
}: FileChipMiniPreviewProps & {
  wrapTrigger?: (trigger: ReactNode) => ReactNode;
}) {
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [isDocumentViewerOpen, setIsDocumentViewerOpen] = useState(false);
  const resolvedFileName = fileName ?? url.split("/").pop() ?? url;
  const { isImage, documentKind } = classifyFilePreview(
    url,
    fileName,
    mediaType,
  );

  const trigger = (
    <FileChipMiniPreviewTrigger
      url={url}
      fileName={fileName}
      mediaType={mediaType}
      sizeClass={sizeClass}
      variant={variant}
      onOpenImage={() => {
        setIsViewerOpen(true);
      }}
      onOpenDocument={() => {
        setIsDocumentViewerOpen(true);
      }}
    />
  );

  return (
    <div className={cn("not-prose relative inline-flex", className)}>
      {wrapTrigger ? wrapTrigger(trigger) : trigger}
      {onRemove ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={removeLabel}
              onClick={onRemove}
              className="bg-background/90 hover:bg-accent focus-visible:ring-ring absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-full border shadow-sm outline-none transition"
            >
              <X className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{removeLabel}</TooltipContent>
        </Tooltip>
      ) : null}
      {isImage ? (
        <ImageViewer
          open={isViewerOpen}
          onOpenChange={setIsViewerOpen}
          src={url}
          alt={resolvedFileName}
          downloadFilename={resolvedFileName}
        />
      ) : null}
      {documentKind ? (
        <DocumentViewer
          open={isDocumentViewerOpen}
          onOpenChange={setIsDocumentViewerOpen}
          url={url}
          fileName={resolvedFileName}
          kind={documentKind}
          mediaType={mediaType}
        />
      ) : null}
    </div>
  );
}

/**
 * Sent-message / timeline surface. Video and audio use the full FileChip
 * inline player; images and documents keep the compact thumbnail frame.
 * Composer drafts use {@link FileChipMiniPreview} (always compact).
 */
export function FileChipMiniPreviewFrame(props: FileChipMiniPreviewProps) {
  const { isVideo, isAudio } = classifyFilePreview(
    props.url,
    props.fileName,
    props.mediaType,
  );
  if (isVideo || isAudio) {
    return (
      <FileChip
        url={props.url}
        fileName={props.fileName}
        mediaType={props.mediaType}
        size={props.size}
        className={cn(
          "min-w-0 w-full max-w-full basis-full shrink",
          props.className,
        )}
      />
    );
  }
  return <FileChipMiniPreviewShell {...props} />;
}

export function FileChipMiniPreview(props: FileChipMiniPreviewProps) {
  const resolvedFileName =
    props.fileName ?? props.url.split("/").pop() ?? props.url;
  const prettySize = formatBytes(props.size);

  return (
    <FileChipMiniPreviewShell
      {...props}
      wrapTrigger={(trigger) => (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="top" className="max-w-64">
            <div className="flex flex-col">
              <span className="truncate">{resolvedFileName}</span>
              {prettySize ? (
                <span className="text-primary-foreground/80">{prettySize}</span>
              ) : null}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    />
  );
}
