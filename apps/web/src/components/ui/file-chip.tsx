"use client";

import { getExtensionFromUrl } from "@sokosumi/utils";
import Image from "next/image";
import { useState } from "react";

import { canUseNextImageSrc } from "@/config/next-image";
import { DocumentViewer } from "@/components/ui/document-viewer";
import { FileTypeIcon } from "@/components/ui/file-icon";
import { ImageViewer } from "@/components/ui/image-viewer";
import { cn } from "@/lib/utils";
import { classifyFilePreview } from "@/lib/utils/file-preview";
import { formatBytes } from "@/lib/utils/format-bytes";

export interface FileChipProps extends React.ComponentPropsWithoutRef<"a"> {
  url: string;
  fileName?: string | null;
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

export function FileChip(props: FileChipProps) {
  const {
    url,
    fileName: fileNameProp,
    size,
    className,
    sizeClass = "size-10",
    iconPx = 40,
    title,
    ...anchorProps
  } = props;
  const fileName = fileNameProp ?? url.split("/").pop() ?? url;
  const { isImage, documentKind } = classifyFilePreview(url, fileNameProp);
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
          <div className={cn("flex size-full items-center justify-center", shouldApplyIconPadding && "p-1")}>
            {(() => {
              const ext = getExtensionFromUrl(url) || "file";
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
        />
      </>
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
