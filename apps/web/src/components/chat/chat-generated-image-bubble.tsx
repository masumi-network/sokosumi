"use client";

import { getExtensionFromUrl } from "@sokosumi/utils";
import { Download, ImageOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ImageViewer } from "@/components/ui/image-viewer";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ChatGeneratedImageBubbleProps {
  alt: string;
  downloadLabel: string;
  src?: string;
}

const DOWNLOAD_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
]);

function fileExtensionForGeneratedImageDownload(src: string): string {
  const dataSubtype = src.match(/^data:image\/([^;]+);base64,/)?.[1];
  if (dataSubtype) {
    const ext =
      dataSubtype === "jpeg" ? "jpg" : dataSubtype.replace("+xml", "");
    return ext.length > 0 ? ext : "png";
  }

  const fromUrl = getExtensionFromUrl(src).toLowerCase();
  if (fromUrl === "jpeg" || fromUrl === "jpg") {
    return "jpg";
  }
  if (DOWNLOAD_IMAGE_EXTENSIONS.has(fromUrl)) {
    return fromUrl;
  }

  return "png";
}

function getGeneratedImageDownloadFilename(src: string): string {
  return `generated-image.${fileExtensionForGeneratedImageDownload(src)}`;
}

export function ChatGeneratedImageBubble({
  alt,
  downloadLabel,
  src,
}: ChatGeneratedImageBubbleProps) {
  const t = useTranslations("Components.ImageViewer");
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const showSkeleton = !src || (!isLoaded && !hasError);
  const canOpenViewer = Boolean(src) && !hasError && isLoaded;

  return (
    <figure className="not-prose my-3 w-full max-w-xl overflow-hidden rounded-xl border border-border bg-muted/20 shadow-sm">
      <div className="relative aspect-square w-full overflow-hidden bg-muted/30">
        {showSkeleton ? (
          <div className="absolute inset-0">
            <Skeleton className="size-full rounded-none" />
            <div className="absolute inset-0 bg-linear-to-br from-transparent via-background/25 to-transparent" />
            <div className="absolute inset-0 animate-pulse bg-linear-to-tr from-transparent via-background/30 to-transparent" />
          </div>
        ) : null}
        {src ? (
          <button
            type="button"
            className={cn(
              "absolute inset-0 block size-full disabled:cursor-default",
              canOpenViewer ? "cursor-zoom-in" : null,
            )}
            aria-label={t("viewImage", { fileName: alt })}
            disabled={!canOpenViewer}
            onClick={() => {
              setIsViewerOpen(true);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={alt}
              className={cn(
                "size-full object-cover transition-opacity duration-300",
                isLoaded && !hasError ? "opacity-100" : "opacity-0",
              )}
              src={src}
              onError={() => {
                setHasError(true);
              }}
              onLoad={() => {
                setIsLoaded(true);
              }}
            />
          </button>
        ) : null}
        {hasError ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <ImageOff className="size-6" aria-hidden="true" />
          </div>
        ) : null}
        {src && !hasError ? (
          <Button
            asChild
            className="absolute top-2 right-2 z-10 size-8 rounded-full border border-border/70 bg-background/85 text-foreground shadow-sm backdrop-blur hover:bg-background"
            size="icon"
            variant="ghost"
          >
            <a
              aria-label={downloadLabel}
              download={getGeneratedImageDownloadFilename(src)}
              href={src}
            >
              <Download className="size-4" aria-hidden="true" />
            </a>
          </Button>
        ) : null}
      </div>
      {src && !hasError ? (
        <ImageViewer
          open={isViewerOpen}
          onOpenChange={setIsViewerOpen}
          src={src}
          alt={alt}
          title={t("title")}
          downloadLabel={downloadLabel}
          downloadFilename={getGeneratedImageDownloadFilename(src)}
        />
      ) : null}
    </figure>
  );
}
