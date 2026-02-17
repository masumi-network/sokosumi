"use client";

import { useEffect, useState } from "react";

import { FileChip, type FileChipProps } from "@/components/ui/file-chip";

interface FileHeadMetadata {
  contentType?: string;
  fileName?: string;
  size?: number;
}

function parseContentDispositionFilename(
  disposition: string | null,
): string | undefined {
  if (!disposition) return undefined;

  const encodedMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const encodedFileName = encodedMatch?.[1];
  if (encodedFileName) {
    try {
      return decodeURIComponent(encodedFileName);
    } catch {
      return encodedFileName;
    }
  }

  const plainMatch = /filename="?([^";]+)"?/i.exec(disposition);
  const plainFileName = plainMatch?.[1];
  return plainFileName || undefined;
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

export function FileChipWithMetadata({
  url,
  title,
  ...props
}: Omit<FileChipProps, "fileName" | "size">) {
  const [metadata, setMetadata] = useState<FileHeadMetadata>();

  useEffect(() => {
    const abortController = new AbortController();
    let cancelled = false;
    setMetadata(undefined);

    async function fetchMetadata() {
      try {
        const response = await fetch(url, {
          method: "HEAD",
          signal: abortController.signal,
        });
        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setMetadata(undefined);
          return;
        }

        setMetadata({
          contentType: response.headers.get("content-type") ?? undefined,
          fileName: parseContentDispositionFilename(
            response.headers.get("content-disposition"),
          ),
          size: parseContentLength(response.headers.get("content-length")),
        });
      } catch {
        if (!cancelled) {
          setMetadata(undefined);
        }
      }
    }

    void fetchMetadata();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [url]);

  return (
    <FileChip
      url={url}
      fileName={metadata?.fileName}
      size={metadata?.size ?? undefined}
      title={title ?? metadata?.contentType}
      {...props}
    />
  );
}
