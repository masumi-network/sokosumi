"use client";

import { useEffect, useState } from "react";
import { parseContentDispositionFilename } from "@/lib/utils/content-disposition";

export interface FileHeadMetadata {
  contentType?: string;
  fileName?: string;
  size?: number;
}

interface FileHeadMetadataState {
  url: string;
  metadata?: FileHeadMetadata;
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

/**
 * Fetches `HEAD` metadata (`content-type`, `content-disposition`,
 * `content-length`) for `FileChipWithMetadata` and aborts in-flight requests on
 * `url` change or unmount.
 */
export function useFileHeadMetadata(url: string): FileHeadMetadata | undefined {
  const [metadataState, setMetadataState] = useState<FileHeadMetadataState>();
  const currentUrlMetadata =
    metadataState?.url === url ? metadataState.metadata : undefined;

  useEffect(() => {
    const abortController = new AbortController();
    let cancelled = false;

    async function fetchMetadata() {
      try {
        const response = await fetch(url, {
          method: "HEAD",
          signal: abortController.signal,
        });
        if (cancelled) return;

        if (!response.ok) {
          setMetadataState({ url });
          return;
        }

        setMetadataState({
          url,
          metadata: {
            contentType: response.headers.get("content-type") ?? undefined,
            fileName: parseContentDispositionFilename(
              response.headers.get("content-disposition"),
            ),
            size: parseContentLength(response.headers.get("content-length")),
          },
        });
      } catch {
        if (!cancelled) {
          setMetadataState({ url });
        }
      }
    }

    void fetchMetadata();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [url]);

  return currentUrlMetadata;
}
