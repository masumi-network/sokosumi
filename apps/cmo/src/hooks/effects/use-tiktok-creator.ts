"use client";

import type { CmoTikTokCreator } from "@sokosumi/core-client";
import { useEffect, useState } from "react";

export interface UseTikTokCreatorResult {
  creator: CmoTikTokCreator | null;
  error: string | null;
}

/**
 * Reads the TikTok creator settings for `draftId` whenever `draftId` or
 * `readCreator` changes, ignoring stale resolutions after cleanup.
 */
export function useTikTokCreator(
  draftId: string,
  readCreator: (
    draftId: string,
  ) => Promise<{ creator: CmoTikTokCreator | null; error: string | null }>,
): UseTikTokCreatorResult {
  const [creator, setCreator] = useState<CmoTikTokCreator | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    readCreator(draftId)
      .then((read) => {
        if (!current) return;
        setCreator(read.creator);
        setError(read.error);
      })
      .catch(() => {
        if (current) setError("TikTok could not be read. Try again.");
      });
    return () => {
      current = false;
    };
  }, [readCreator, draftId]);

  return { creator, error };
}
