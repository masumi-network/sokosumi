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
    const controller = new AbortController();

    void (async () => {
      setText({ kind: "loading" });
      try {
        const response = await fetch(source, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.text();
        if (!controller.signal.aborted) setText({ kind: "ready", text: body });
      } catch {
        // A preview that cannot load is not an error screen: the download
        // below still works, and that is what the reader came for.
        if (!controller.signal.aborted) setText({ kind: "failed" });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [isText, source]);

  return text;
}
