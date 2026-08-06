"use client";

import { getExtensionFromUrl } from "@sokosumi/utils";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { canUseNextImageSrc } from "@/config/next-image";
import { DocumentViewer } from "@/components/ui/document-viewer";
import { FileTypeIcon } from "@/components/ui/file-icon";
import { ImageViewer } from "@/components/ui/image-viewer";
import { cn } from "@/lib/utils";
import {
  classifyFilePreview,
  stripForcedDownloadParam,
} from "@/lib/utils/file-preview";
import { formatBytes } from "@/lib/utils/format-bytes";

export interface FileChipProps extends React.ComponentPropsWithoutRef<"a"> {
  url: string;
  fileName?: string | null;
  mediaType?: string | null;
  size?: number | bigint | null;
  /**
   * Tailwind size class (e.g., `size-8`, `size-10`). Defaults to `size-10`.
   */
  sizeClass?: string;
  /**
   * Approximate pixel size of the icon/thumbnail for layout hints.
   * Used for next/image `sizes` attribute. Defaults to 40.
   */
  iconPx?: number;
}

/**
 * Native `<video controls>` reports a large min-content width (~476–570px in
 * Chromium). Inside Radix ScrollArea's `display:table` content wrapper that
 * floor becomes the message column's minimum and Chrome device mode appears
 * to "stop resizing". Absolutely positioning the video removes it from
 * min-content; chat message ScrollAreas also pass `shrinkContent` so the
 * table wrapper can shrink. The frame keeps width from the row and height
 * from aspect-ratio (capped like large image previews).
 */
function FileChipVideoFrame({
  src,
  fileName,
}: {
  src: string;
  fileName: string;
}) {
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined);

  return (
    <div
      data-testid="file-chip-video-frame"
      className="relative min-w-0 w-full max-w-full max-h-80 overflow-hidden rounded-lg bg-black/20"
      style={{ aspectRatio: aspectRatio ?? 16 / 9 }}
    >
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        className="absolute inset-0 size-full object-contain"
        aria-label={fileName}
        onLoadedMetadata={(event) => {
          const { videoWidth, videoHeight } = event.currentTarget;
          if (videoWidth > 0 && videoHeight > 0) {
            setAspectRatio(videoWidth / videoHeight);
          }
        }}
      />
    </div>
  );
}

export function FileChip(props: FileChipProps) {
  const {
    url,
    fileName: fileNameProp,
    mediaType,
    size,
    className,
    sizeClass = "size-10",
    iconPx = 40,
    title,
    ...anchorProps
  } = props;
  const tDocument = useTranslations("Components.DocumentViewer");
  const fileName = fileNameProp ?? url.split("/").pop() ?? url;
  const { isImage, isVideo, isAudio, documentKind } = classifyFilePreview(
    url,
    fileNameProp,
    mediaType,
  );
  const canUseNextImage = canUseNextImageSrc(url);
  const prettySize = formatBytes(size);
  const containerSizeClass = sizeClass;
  const shouldApplyIconPadding = (() => {
    const match = containerSizeClass.match(/size-(\d+)/);
    const numeric = match ? Number(match[1]) : NaN;
    return Number.isFinite(numeric) && numeric > 6;
  })();
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [isDocumentViewerOpen, setIsDocumentViewerOpen] = useState(false);

  const chipClassName = cn(
    "hover:bg-accent focus-visible:ring-ring inline-flex w-full max-w-full items-center gap-3 rounded-md border p-2 transition outline-none",
    className,
  );

  const content = (
    <>
      <div
        className={cn(
          "bg-accent/50 relative shrink-0 rounded",
          containerSizeClass,
        )}
      >
        {isImage ? (
          <div className="relative size-full overflow-hidden rounded">
            {canUseNextImage ? (
              <Image
                src={url}
                alt={fileName}
                fill
                sizes={`${iconPx}px`}
                className="object-cover"
              />
            ) : (
              <img
                src={url}
                alt={fileName}
                className="size-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            )}
          </div>
        ) : (
          <div
            className={cn(
              "flex size-full items-center justify-center",
              shouldApplyIconPadding && "p-1",
            )}
          >
            {(() => {
              const ext = getExtensionFromUrl(fileNameProp ?? url) || "file";
              return <FileTypeIcon extension={ext} />;
            })()}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{fileName}</div>
        {prettySize && (
          <div className="text-muted-foreground truncate text-xs">
            {prettySize}
          </div>
        )}
      </div>
    </>
  );

  if (isImage) {
    return (
      <>
        <button
          type="button"
          title={title}
          className={chipClassName}
          onClick={() => setIsImageViewerOpen(true)}
        >
          {content}
        </button>
        <ImageViewer
          open={isImageViewerOpen}
          onOpenChange={setIsImageViewerOpen}
          src={url}
          alt={fileName}
          downloadFilename={fileName}
        />
      </>
    );
  }

  if (documentKind) {
    return (
      <>
        <button
          type="button"
          title={title}
          className={chipClassName}
          onClick={() => setIsDocumentViewerOpen(true)}
        >
          {content}
        </button>
        <DocumentViewer
          open={isDocumentViewerOpen}
          onOpenChange={setIsDocumentViewerOpen}
          url={url}
          fileName={fileName}
          kind={documentKind}
          mediaType={mediaType}
        />
      </>
    );
  }

  if (isVideo || isAudio) {
    const mediaSrc = stripForcedDownloadParam(url);
    return (
      <div
        className={cn(
          // min-w-0 lets the chip shrink in flex message rows (large images do
          // the same); overflow-hidden clamps native video control min-width.
          "flex min-w-0 w-full max-w-full flex-col gap-2 overflow-hidden rounded-md border p-2",
          className,
        )}
        title={title}
        data-testid={isVideo ? "file-chip-video" : "file-chip-audio"}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "bg-accent/50 relative flex shrink-0 items-center justify-center rounded",
              containerSizeClass,
              shouldApplyIconPadding && "p-1",
            )}
          >
            <FileTypeIcon
              extension={getExtensionFromUrl(fileNameProp ?? url) || "file"}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{fileName}</div>
            {prettySize ? (
              <div className="text-muted-foreground truncate text-xs">
                {prettySize}
              </div>
            ) : null}
          </div>
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-muted-foreground hover:text-foreground shrink-0 text-xs underline underline-offset-2"
          >
            {tDocument("download")}
          </a>
        </div>
        {isVideo ? (
          <FileChipVideoFrame
            key={mediaSrc}
            src={mediaSrc}
            fileName={fileName}
          />
        ) : (
          <audio
            src={mediaSrc}
            controls
            preload="metadata"
            className="min-w-0 w-full max-w-full"
            aria-label={fileName}
          />
        )}
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={title}
      {...anchorProps}
      className={chipClassName}
    >
      {content}
    </a>
  );
}
