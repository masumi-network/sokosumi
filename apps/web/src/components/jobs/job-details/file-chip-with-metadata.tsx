"use client";

import { useQuery } from "@tanstack/react-query";

import { FileChip, type FileChipProps } from "@/components/ui/file-chip";
import {
  FileChipMiniPreview,
  type FileChipMiniPreviewProps,
} from "@/components/ui/file-chip-mini-preview";
import { parseContentDispositionFilename } from "@/lib/utils/content-disposition";

interface FileHeadMetadata {
  contentType?: string;
  fileName?: string;
  size?: number;
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

function useFileHeadMetadata(url: string): FileHeadMetadata | undefined {
  const { data } = useQuery({
    queryKey: ["file-head-metadata", url],
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    networkMode: "always",
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<FileHeadMetadata> => {
      const response = await fetch(url, {
        method: "HEAD",
        signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch file metadata (${response.status})`);
      }

      return {
        contentType: response.headers.get("content-type") ?? undefined,
        fileName: parseContentDispositionFilename(
          response.headers.get("content-disposition"),
        ),
        size: parseContentLength(response.headers.get("content-length")),
      };
    },
  });

  return data;
}

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
