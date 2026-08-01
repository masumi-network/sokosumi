"use client";

import {
  Download,
  ImageIcon,
  MoreVertical,
  Printer,
  Search,
  XIcon,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ImageViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
  downloadFilename?: string;
  className?: string;
}

interface ViewerUiState {
  zoom: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

const toolbarButtonClassName =
  "size-9 shrink-0 rounded-full text-white hover:bg-white/10 hover:text-white";

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function printImage(src: string, alt: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    return;
  }

  const escapedSrc = src.replaceAll('"', "&quot;");
  const escapedAlt = alt.replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  doc.open();
  doc.write(`<!doctype html><html><head><title>${escapedAlt}</title>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  img { max-width: 100%; max-height: 100vh; display: block; margin: 0 auto; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style></head><body><img src="${escapedSrc}" alt="${escapedAlt}" /></body></html>`);
  doc.close();

  function cleanup(): void {
    iframe.remove();
  }

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      window.setTimeout(cleanup, 500);
    }
  };
}

async function copyImageToClipboard(src: string): Promise<void> {
  try {
    const response = await fetch(src);
    const blob = await response.blob();
    const mimeType = blob.type || "image/png";
    await navigator.clipboard.write([
      new ClipboardItem({ [mimeType]: blob }),
    ]);
  } catch {
    try {
      await navigator.clipboard.writeText(src);
    } catch {
      // Best-effort; CORS or clipboard permission may deny both paths.
    }
  }
}

function ImageViewerChrome({
  src,
  alt,
  downloadFilename,
  onOpenChange,
}: {
  src: string;
  alt: string;
  downloadFilename?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Components.ImageViewer");
  const [{ zoom }, setUiState] = useState<ViewerUiState>({ zoom: 1 });
  const displayName = downloadFilename ?? alt;

  function setZoom(nextZoom: number): void {
    setUiState({ zoom: clampZoom(nextZoom) });
  }

  function handleZoomIn(): void {
    setZoom(zoom + ZOOM_STEP);
  }

  function handleZoomOut(): void {
    setZoom(zoom - ZOOM_STEP);
  }

  function handleZoomReset(): void {
    setZoom(1);
  }

  function handleStageClick(): void {
    onOpenChange(false);
  }

  function handlePrint(): void {
    printImage(src, alt);
  }

  function handleOpenInNewTab(): void {
    window.open(src, "_blank", "noopener,noreferrer");
  }

  function handleCopyImage(): void {
    void copyImageToClipboard(src);
  }

  return (
    <>
      <DialogTitle className="sr-only">{t("title")}</DialogTitle>
      <DialogDescription className="sr-only">{alt}</DialogDescription>
      <div
        className="flex items-center justify-between gap-3 bg-black/80 px-3 py-2 text-white"
        data-testid="image-viewer-toolbar"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="flex min-w-0 items-center gap-1">
          <DialogClose asChild>
            <Button
              type="button"
              aria-label={t("close")}
              className={toolbarButtonClassName}
              size="icon"
              variant="ghost"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </Button>
          </DialogClose>
          <ImageIcon className="size-4 shrink-0 opacity-80" aria-hidden="true" />
          <span className="truncate text-sm">{displayName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            aria-label={t("print")}
            className={toolbarButtonClassName}
            size="icon"
            variant="ghost"
            onClick={handlePrint}
          >
            <Printer className="size-4" aria-hidden="true" />
          </Button>
          <Button
            asChild
            className={toolbarButtonClassName}
            size="icon"
            variant="ghost"
          >
            <a aria-label={t("download")} download={downloadFilename} href={src}>
              <Download className="size-4" aria-hidden="true" />
            </a>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                aria-label={t("more")}
                className={toolbarButtonClassName}
                size="icon"
                variant="ghost"
              >
                <MoreVertical className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={handleOpenInNewTab}>
                {t("openInNewTab")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleCopyImage}>
                {t("copyImage")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center bg-black"
        data-testid="image-viewer-stage"
        onClick={handleStageClick}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          data-zoom={zoom}
          className="max-h-full max-w-full object-contain transition-transform"
          style={{ transform: `scale(${zoom})` }}
          onClick={(event) => {
            event.stopPropagation();
          }}
        />
        <div
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/80 px-2 py-1 text-white"
          data-testid="image-viewer-zoom"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Button
            type="button"
            aria-label={t("zoomOut")}
            className={toolbarButtonClassName}
            size="icon"
            variant="ghost"
            disabled={zoom <= MIN_ZOOM}
            onClick={handleZoomOut}
          >
            <ZoomOut className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            aria-label={t("zoomReset")}
            className={toolbarButtonClassName}
            size="icon"
            variant="ghost"
            onClick={handleZoomReset}
          >
            <Search className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            aria-label={t("zoomIn")}
            className={toolbarButtonClassName}
            size="icon"
            variant="ghost"
            disabled={zoom >= MAX_ZOOM}
            onClick={handleZoomIn}
          >
            <ZoomIn className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </>
  );
}

export function ImageViewer({
  open,
  onOpenChange,
  src,
  alt,
  downloadFilename,
  className,
}: ImageViewerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "fixed inset-0 top-0 left-0 z-50 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-black p-0 shadow-none sm:max-w-none",
          className,
        )}
        data-testid="image-viewer"
      >
        <ImageViewerChrome
          key={src}
          src={src}
          alt={alt}
          downloadFilename={downloadFilename}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}
