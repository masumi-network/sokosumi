"use client";

import { useEffect } from "react";

import type { ComposerActiveFormats } from "@/lib/utils/composer-active-formats";

/**
 * Publishes active formats for `ComposerWysiwygEditor` whenever a subscriber
 * attaches or changes, and on Activity reveal.
 */
export function useComposerActiveFormatsPublish(
  onActiveFormatsChange: ((formats: ComposerActiveFormats) => void) | undefined,
  publishActiveFormats: () => void,
): void {
  useEffect(() => {
    if (!onActiveFormatsChange) return;
    publishActiveFormats();
  }, [onActiveFormatsChange, publishActiveFormats]);
}
