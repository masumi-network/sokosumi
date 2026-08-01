"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
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
  downloadFilename?: string;
  className?: string;
}

export function ImageViewer({
  open,
  onOpenChange,
  src,
  alt,
  title,
  downloadLabel,
  downloadFilename,
  className,
}: ImageViewerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "bg-background/95 flex w-[min(96vw,72rem)] max-w-[min(96vw,72rem)] flex-col gap-3 border-border/60 p-3 sm:p-4",
          className,
        )}
        data-testid="image-viewer"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{alt}</DialogDescription>
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-muted/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="max-h-[min(85dvh,48rem)] max-w-full object-contain"
          />
          <Button
            asChild
            className="absolute top-2 left-2 z-10 size-8 rounded-full border border-border/70 bg-background/85 text-foreground shadow-sm backdrop-blur hover:bg-background"
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
