"use client";

import { Download, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ImageViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
  title: string;
  downloadLabel: string;
  closeLabel: string;
  downloadFilename?: string;
  className?: string;
}

const toolbarActionClassName =
  "size-9 rounded-full border border-border/80 bg-background text-foreground shadow-sm hover:bg-muted";

export function ImageViewer({
  open,
  onOpenChange,
  src,
  alt,
  title,
  downloadLabel,
  closeLabel,
  downloadFilename,
  className,
}: ImageViewerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex w-[min(96vw,72rem)] max-w-[min(96vw,72rem)] flex-col gap-0 overflow-hidden border-border/60 p-0",
          className,
        )}
        data-testid="image-viewer"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{alt}</DialogDescription>
        <div
          className="bg-background flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2"
          data-testid="image-viewer-toolbar"
        >
          <Button
            asChild
            className={toolbarActionClassName}
            size="icon"
            variant="ghost"
          >
            <a
              aria-label={downloadLabel}
              download={downloadFilename}
              href={src}
            >
              <Download className="size-4" aria-hidden="true" />
            </a>
          </Button>
          <DialogClose asChild>
            <Button
              type="button"
              aria-label={closeLabel}
              className={toolbarActionClassName}
              size="icon"
              variant="ghost"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>
        <div
          className="flex min-h-0 flex-1 items-center justify-center bg-muted/40 p-4 sm:p-6"
          data-testid="image-viewer-stage"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="max-h-[min(80dvh,44rem)] max-w-full object-contain"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
