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

/** Matches Tailwind `max-h-80` (20rem). Used to derive width from aspect ratio. */
const VIDEO_FRAME_MAX_HEIGHT_REM = 20;

/**
 * Native `<video controls>` reports a large min-content width (~476–570px in
 * Chromium). Inside Radix ScrollArea's `display:table` content wrapper that
 * floor becomes the message column's minimum and Chrome device mode appears
 * to "stop resizing". Absolutely positioning the video removes it from
 * min-content; chat message ScrollAreas also pass `shrinkContent` so the
 * table wrapper can shrink.
 *
 * Explicit width from max-height × aspect-ratio so a `w-fit` chip hugs the
 * video (portrait ≈ phone width). `maxWidth: 100%` still fits narrow columns;
 * height stays capped at max-h-80.
 */
function FileChipVideoFrame({
  src,
  fileName,
}: {
  src: string;
  fileName: string;
}) {
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined);
  const resolvedAspectRatio = aspectRatio ?? 16 / 9;
  // Fixed precision so style stays stable across engines (happy-dom rounds).
  const frameWidthRem = (
    VIDEO_FRAME_MAX_HEIGHT_REM * resolvedAspectRatio
  ).toFixed(4);

  return (
    <div
      data-testid="file-chip-video-frame"
      className="relative min-w-0 max-w-full overflow-hidden rounded-lg bg-black/20"
      style={{
        aspectRatio: resolvedAspectRatio,
        width: `${frameWidthRem}rem`,
        maxWidth: "100%",
        maxHeight: `${VIDEO_FRAME_MAX_HEIGHT_REM}rem`,
      }}
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
          // Video: w-fit so the card hugs the frame (chat-bubble style).
          // Audio: w-full for usable native controls. Both cap at max-w-sm.
          // overflow-hidden clamps native control min-width in ScrollAreas.
          "flex min-w-0 max-w-sm flex-col gap-2 overflow-hidden rounded-md border p-2",
          isVideo ? "w-fit" : "w-full",
          className,
        )}
        title={title}
        data-testid={isVideo ? "file-chip-video" : "file-chip-audio"}
      >
        {/*
          w-0 min-w-full: size header to the video frame, not the full filename
          max-content (keeps long names truncated inside a portrait chip).
        */}
        <div className="flex w-0 min-w-full items-center gap-3">
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
