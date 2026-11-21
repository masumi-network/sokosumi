"use client";

import { type RefObject, useEffect, useEffectEvent } from "react";

export interface MessageEditComposerFocusHandle {
  focusAtEnd(): void;
}

/**
 * Focuses `MessageEditComposer` at the end of its content once on mount (or
 * React Activity reveal).
 */
export function useMessageEditComposerFocus(
  editorRef: RefObject<MessageEditComposerFocusHandle | null>,
): void {
  const focusAtEnd = useEffectEvent(() => {
    editorRef.current?.focusAtEnd();
  });

  useEffect(() => {
    focusAtEnd();
  }, []);
}
