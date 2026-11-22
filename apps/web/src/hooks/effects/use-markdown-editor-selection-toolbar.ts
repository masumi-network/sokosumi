"use client";

import { type RefObject, useCallback, useEffect, useState } from "react";

export interface UseMarkdownEditorSelectionToolbarOptions {
  editorRef: RefObject<HTMLDivElement | null>;
  savedSelectionRangeRef: RefObject<Range | null>;
  saveSelectionRange: () => void;
  variant: "field" | "document";
}

export interface UseMarkdownEditorSelectionToolbarResult {
  selectionRect: DOMRect | null;
  updateSelectionToolbar: () => void;
}

/**
 * Tracks the active text selection rectangle for `MarkdownEditor`'s floating
 * `"document"` format toolbar by subscribing to `document` `selectionchange`.
 */
export function useMarkdownEditorSelectionToolbar({
  editorRef,
  savedSelectionRangeRef,
  saveSelectionRange,
  variant,
}: UseMarkdownEditorSelectionToolbarOptions): UseMarkdownEditorSelectionToolbarResult {
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);

  const updateSelectionToolbar = useCallback(() => {
    if (variant !== "document") {
      savedSelectionRangeRef.current = null;
      setSelectionRect(null);
      return;
    }

    const selection = window.getSelection();
    if (
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount === 0 ||
      !editorRef.current
    ) {
      savedSelectionRangeRef.current = null;
      setSelectionRect(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editorRef.current.contains(range.commonAncestorContainer)) {
      savedSelectionRangeRef.current = null;
      setSelectionRect(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      savedSelectionRangeRef.current = null;
      setSelectionRect(null);
      return;
    }

    saveSelectionRange();
    setSelectionRect(rect);
  }, [saveSelectionRange, variant]);

  useEffect(() => {
    if (variant !== "document") {
      setSelectionRect(null);
      return;
    }

    document.addEventListener("selectionchange", updateSelectionToolbar);
    return () => {
      document.removeEventListener("selectionchange", updateSelectionToolbar);
    };
  }, [updateSelectionToolbar, variant]);

  return { selectionRect, updateSelectionToolbar };
}
