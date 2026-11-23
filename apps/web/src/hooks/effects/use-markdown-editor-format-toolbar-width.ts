"use client";

import { type RefObject, useLayoutEffect, useState } from "react";

export const FORMAT_TOOLBAR_FALLBACK_WIDTH_PX = 244;

/**
 * Measures `MarkdownEditor`'s floating format toolbar width before paint
 * whenever `selectionRect` updates so horizontal clamping avoids overflow.
 */
export function useMarkdownEditorFormatToolbarWidth(
  formatToolbarRef: RefObject<HTMLDivElement | null>,
  selectionRect: DOMRect | null,
): number {
  const [formatToolbarWidth, setFormatToolbarWidth] = useState(
    FORMAT_TOOLBAR_FALLBACK_WIDTH_PX,
  );

  useLayoutEffect(() => {
    if (!selectionRect || !formatToolbarRef.current) return;
    const width = formatToolbarRef.current.getBoundingClientRect().width;
    if (width > 0) {
      setFormatToolbarWidth(width);
    }
  }, [selectionRect]);

  return formatToolbarWidth;
}
