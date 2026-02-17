"use client";

import { useEffect, useMemo, useState } from "react";

import { FileChip, type FileChipProps } from "@/components/ui/file-chip";
import { parseContentDispositionFilename } from "@/lib/utils/content-disposition";

interface FileHeadMetadata {
  contentType: string | null;
  fileName: string | null;
  size: number | null;
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

interface FileChipWithMetadataProps extends Omit<
  FileChipProps,
  "fileName" | "size"
> {
  fallbackFileName?: string | null;
}

export function FileChipWithMetadata({
  url,
  fallbackFileName,
  ...props
}: FileChipWithMetadataProps) {
  const [metadata, setMetadata] = useState<FileHeadMetadata | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let mounted = true;

    async function fetchMetadata() {
      try {
        const response = await fetch(url, {
          method: "HEAD",
          signal: abortController.signal,
        });
        if (!response.ok) {
          if (mounted) setMetadata(null);
          return;
        }

        if (!mounted) return;
        setMetadata({
          contentType: response.headers.get("content-type"),
          fileName: parseContentDispositionFilename(
            response.headers.get("content-disposition"),
          ),
          size: parseContentLength(response.headers.get("content-length")),
        });
      } catch {
        if (mounted) {
          setMetadata(null);
        }
      }
    }

    void fetchMetadata();

    return () => {
      mounted = false;
      abortController.abort();
    };
  }, [url]);

  const title = useMemo(() => {
    if (props.title) return props.title;
    return metadata?.contentType ?? undefined;
  }, [metadata?.contentType, props.title]);

  return (
    <FileChip
      url={url}
      fileName={metadata?.fileName ?? fallbackFileName ?? undefined}
      size={metadata?.size ?? undefined}
      title={title}
      {...props}
    />
  );
}
