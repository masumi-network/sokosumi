"use client";

import Image from "next/image";
import { X } from "lucide-react";

import { FileTypeIcon } from "@/components/ui/file-icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/utils/format-bytes";
import { getExtensionFromUrl, isImageUrl } from "@/lib/utils/file";

export interface FileChipMiniPreviewProps {
  url: string;
  fileName?: string | null;
  size?: number | bigint | null;
  className?: string;
  sizeClass?: string;
  onRemove?: () => void;
  removeLabel?: string;
}

export function FileChipMiniPreview({
  url,
  fileName,
  size,
  className,
  sizeClass = "size-20",
  onRemove,
  removeLabel = "Remove file",
}: FileChipMiniPreviewProps) {
  const resolvedFileName = fileName ?? url.split("/").pop() ?? url;
  const isImage = isImageUrl(url);
  const extension = getExtensionFromUrl(url);
  const prettySize = formatBytes(size);

  return (
    <div className={cn("relative inline-flex", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(
              "group bg-accent/30 hover:bg-accent/50 focus-visible:ring-ring relative inline-flex overflow-hidden rounded-xl border outline-none transition",
              sizeClass,
            )}
          >
            {isImage ? (
              <Image
                src={url}
                alt={resolvedFileName}
                fill
                sizes="80px"
                className="object-cover"
              />
            ) : (
              <div className="text-muted-foreground flex size-full items-center justify-center">
                <div className="flex size-8 items-center justify-center rounded-md">
                  <FileTypeIcon extension={extension || "file"} />
                </div>
              </div>
            )}
          </a>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64">
          <div className="flex flex-col">
            <span className="truncate">{resolvedFileName}</span>
            {prettySize ? (
              <span className="text-primary-foreground/80">{prettySize}</span>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
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
          <TooltipContent side="top">Remove file</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
