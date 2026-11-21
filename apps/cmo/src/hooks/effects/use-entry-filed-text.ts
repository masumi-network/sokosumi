"use client";

import { useEffect, useState } from "react";

/**
 * Loads the filed text for a calendar entry when `filed` is true, clearing the
 * previous entry's text immediately on entry changes.
 */
export function useEntryFiledText(
  entryId: string,
  filed: boolean,
  loadText?: (entryId: string) => Promise<string | null>,
): string | null {
  const [filedText, setFiledText] = useState<string | null>(null);

  useEffect(() => {
    // Stepping to another piece must not show the last one's words.
    setFiledText(null);
    if (!filed || !loadText) return;
    let current = true;
    loadText(entryId)
      .then((text) => {
        if (current) setFiledText(text);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [entryId, filed, loadText]);

  return filedText;
}
