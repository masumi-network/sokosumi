"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  Ellipsis,
  ImageIcon,
  Minus,
  Plus,
  Printer,
  Search,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  type PointerEvent,
  useRef,
  useState,
} from "react";

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

export interface ImageViewerImage {
  src: string;
  alt: string;
  downloadFilename?: string;
}

interface ImageViewerProps {
  images: readonly ImageViewerImage[];
  /** The open image; `null`, or a src missing from `images`, keeps it closed. */
  activeSrc: string | null;
  onActiveSrcChange: (src: string | null) => void;
  className?: string;
}

interface ViewerUiState {
  zoom: number;
}

/** Horizontal travel, in CSS pixels, that turns a touch into a swipe. */
const SWIPE_THRESHOLD = 50;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

// aria-disabled, not disabled: a disabled button drops focus to the body,
// and the arrow keys stop reaching the viewer after clicking to an end.
const stepButtonClassName =
  "absolute top-1/2 size-11 -translate-y-1/2 rounded-full bg-scrim-strong text-on-media hover:bg-scrim hover:text-on-media aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-scrim-strong";

const toolbarButtonClassName =
  "size-9 shrink-0 rounded-full text-on-media hover:bg-on-media-quaternary hover:text-on-media";

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

  doc.open();
  doc.write(`<!doctype html><html><head><title></title>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  img { max-width: 100%; max-height: 100dvh; display: block; margin: 0 auto; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style></head><body></body></html>`);
  doc.close();

  doc.title = alt;

  const image = doc.createElement("img");
  image.src = src;
  image.alt = alt;
  doc.body.appendChild(image);

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
  position,
  total,
  onClose,
  onPrevious,
  onNext,
}: ImageViewerImage & {
  position: number;
  total: number;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const t = useTranslations("Components.ImageViewer");
  const [{ zoom }, setUiState] = useState<ViewerUiState>({ zoom: 1 });
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
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
    onClose();
  }

  // A zoomed image is being inspected, not browsed, so only 100% swipes:
  // neither the viewer's zoom nor a browser pinch-zoom of the page.
  function handleStagePointerDown(event: PointerEvent<HTMLDivElement>): void {
    const pageScale = window.visualViewport?.scale ?? 1;
    swipeStartRef.current =
      event.pointerType !== "mouse" && zoom === 1 && pageScale === 1
        ? { x: event.clientX, y: event.clientY }
        : null;
  }

  function handleStagePointerUp(event: PointerEvent<HTMLDivElement>): void {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) {
      return;
    }
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    const isSwipe =
      Math.abs(deltaX) >= SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY);
    if (!isSwipe) {
      return;
    }
    if (deltaX < 0) {
      onNext();
    } else {
      onPrevious();
    }
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
        className="flex items-center justify-between gap-3 bg-scrim-strong px-3 py-2 text-on-media"
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
          {total > 1 ? (
            <span className="shrink-0 text-sm text-on-media-muted tabular-nums">
              {t("position", { current: position, total })}
            </span>
          ) : null}
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
                <Ellipsis className="size-4" aria-hidden="true" />
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
        className="relative flex min-h-0 flex-1 touch-pinch-zoom items-center justify-center bg-media-ground"
        data-testid="image-viewer-stage"
        onClick={handleStageClick}
        onPointerDown={handleStagePointerDown}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={() => {
          swipeStartRef.current = null;
        }}
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
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-scrim-strong px-2 py-1 text-on-media"
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
            <Minus className="size-4" aria-hidden="true" />
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
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </>
  );
}

export function ImageViewer({
  images,
  activeSrc,
  onActiveSrcChange,
  className,
}: ImageViewerProps) {
  const t = useTranslations("Components.ImageViewer");
  const activeIndex = images.findIndex((image) => image.src === activeSrc);
  const activeImage = images[activeIndex];
  const previousImage =
    activeIndex > 0 ? images[activeIndex - 1] : undefined;
  const nextImage =
    activeIndex >= 0 ? images[activeIndex + 1] : undefined;

  function handleClose(): void {
    onActiveSrcChange(null);
  }

  function handlePrevious(): void {
    if (previousImage) {
      onActiveSrcChange(previousImage.src);
    }
  }

  function handleNext(): void {
    if (nextImage) {
      onActiveSrcChange(nextImage.src);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // The More menu portals out of the viewer but still bubbles here through
    // React; its own arrow keys must not step the image.
    const fromViewer =
      event.target instanceof Node && event.currentTarget.contains(event.target);
    if (
      !fromViewer ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      handlePrevious();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      handleNext();
    }
  }

  return (
    <Dialog
      open={activeImage !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          handleClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          "fixed inset-0 top-0 left-0 z-50 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-media-ground p-0 shadow-none sm:max-w-none",
          className,
        )}
        data-testid="image-viewer"
        // The pinned-message row is a button. This dialog is portaled, but
        // React still bubbles the click to that row and would jump away.
        onClick={(event) => {
          event.stopPropagation();
        }}
        onKeyDown={handleKeyDown}
      >
        {activeImage ? (
          <ImageViewerChrome
            key={activeImage.src}
            {...activeImage}
            position={activeIndex + 1}
            total={images.length}
            onClose={handleClose}
            onPrevious={handlePrevious}
            onNext={handleNext}
          />
        ) : null}
        {[previousImage, nextImage].map((image) =>
          image ? (
            // A hidden img still fetches, so stepping shows a cached image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={image.src}
              src={image.src}
              alt=""
              hidden
              data-preload
            />
          ) : null,
        )}
        {images.length > 1 ? (
          <>
            <Button
              type="button"
              aria-label={t("previous")}
              aria-disabled={previousImage === undefined || undefined}
              className={cn(stepButtonClassName, "left-4")}
              size="icon"
              variant="ghost"
              onClick={handlePrevious}
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              aria-label={t("next")}
              aria-disabled={nextImage === undefined || undefined}
              className={cn(stepButtonClassName, "right-4")}
              size="icon"
              variant="ghost"
              onClick={handleNext}
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </Button>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
