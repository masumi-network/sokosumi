"use client";

import { FileChip, type FileChipProps } from "@/components/ui/file-chip";
import {
  FileChipMiniPreview,
  type FileChipMiniPreviewProps,
} from "@/components/ui/file-chip-mini-preview";
import { useFileHeadMetadata } from "@/hooks/effects/use-file-head-metadata";

export function FileChipWithMetadata({
  url,
  title,
  mediaType,
  fileName,
  size,
  ...props
}: Omit<FileChipProps, "fileName" | "size"> & {
  fileName?: string | null;
  size?: number | bigint | null;
}) {
  const metadata = useFileHeadMetadata(url);

  return (
    <FileChip
      url={url}
      fileName={fileName ?? metadata?.fileName}
      mediaType={mediaType ?? metadata?.contentType}
      size={size ?? metadata?.size ?? undefined}
      title={title ?? metadata?.contentType}
      {...props}
    />
  );
}

export function FileChipMiniPreviewWithMetadata({
  url,
  fileName,
  mediaType,
  ...props
}: Omit<FileChipMiniPreviewProps, "fileName"> & { fileName?: string | null }) {
  const metadata = useFileHeadMetadata(url);

  return (
    <FileChipMiniPreview
      url={url}
      fileName={fileName ?? metadata?.fileName}
      mediaType={mediaType ?? metadata?.contentType}
      size={metadata?.size}
      {...props}
    />
  );
}
