"use client";

import { useEffect, useState } from "react";

export type DriveFilePreviewTextState =
  | { kind: "loading" }
  | { kind: "ready"; text: string }
  | { kind: "failed" };

/**
 * Loads plain-text or Markdown bytes for `DriveFilePreview` from the authorized
 * content proxy when the file qualifies for inline text rendering.
 */
export function useDriveFilePreviewText(
  isText: boolean,
  source: string,
): DriveFilePreviewTextState {
  const [text, setText] = useState<DriveFilePreviewTextState>({
    kind: "loading",
  });

  useEffect(() => {
    if (!isText) return;
    let cancelled = false;

    void (async () => {
      setText({ kind: "loading" });
      try {
        const response = await fetch(source);
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.text();
        if (!cancelled) setText({ kind: "ready", text: body });
      } catch {
        // A preview that cannot load is not an error screen: the download
        // below still works, and that is what the reader came for.
        if (!cancelled) setText({ kind: "failed" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isText, source]);

  return text;
}
