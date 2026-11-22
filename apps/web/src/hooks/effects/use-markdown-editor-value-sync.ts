"use client";

import { type RefObject, useEffect } from "react";
import { syncMarkdownEditorEmptyState } from "@/lib/utils/markdown-editor-utils";

/**
 * Syncs external `value` prop updates into `MarkdownEditor`'s `contentEditable`
 * DOM when not triggered by an internal edit and avoiding cursor jumps while
 * focused unless externally cleared.
 */
export function useMarkdownEditorValueSync(
  editorRef: RefObject<HTMLDivElement | null>,
  isInternalChange: RefObject<boolean>,
  value: string,
  convertMarkdownToHtml: (text: string) => string,
): void {
  // Initialize editor content from value prop
  useEffect(() => {
    if (editorRef.current && !isInternalChange.current) {
      const currentHtml = editorRef.current.innerHTML;
      const newHtml = convertMarkdownToHtml(value);
      const isFocused = editorRef.current.contains(document.activeElement);
      const isExternalClear = value.trim().length === 0;

      // Only update if content actually changed (avoid cursor jumping)
      if (currentHtml !== newHtml && (!isFocused || isExternalClear)) {
        editorRef.current.innerHTML = newHtml || "";
        syncMarkdownEditorEmptyState(editorRef.current);
      }
    }
    isInternalChange.current = false;
  }, [value, convertMarkdownToHtml]);
}
