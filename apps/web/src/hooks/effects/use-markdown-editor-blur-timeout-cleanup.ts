"use client";

import { type RefObject, useEffect } from "react";

/**
 * Clears any pending `MarkdownEditor` mention-dropdown blur timeout on passive
 * unmount or React `<Activity>` hide without altering `handleBlur`'s
 * non-cancelling timeout schedule.
 */
export function useMarkdownEditorBlurTimeoutCleanup(
  blurTimeoutRef: RefObject<NodeJS.Timeout | number | null>,
): void {
  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);
}
