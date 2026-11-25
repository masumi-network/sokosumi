"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ComposerSuggestion } from "@/components/chat/composer-suggestions";
import { ROOM_COMPOSER_MENTION_ANCHOR_ATTR } from "@/components/chat/room-message-composer";
import {
  getCaretRect,
  getMentionPopupPositionFromAnchorRect,
  getPopupPositionFromRect,
  type TriggerPosition,
} from "@/components/ui/mention-textarea-utils";

function measureSuggestionPopupPosition(
  editor: HTMLElement,
  kind: ComposerSuggestion["kind"],
): TriggerPosition {
  if (kind === "mention" || kind === "emoji" || kind === "channel") {
    const shell = editor.closest(`[${ROOM_COMPOSER_MENTION_ANCHOR_ATTR}]`);
    if (shell instanceof HTMLElement) {
      return getMentionPopupPositionFromAnchorRect(
        shell.getBoundingClientRect(),
      );
    }
  }
  const caretRect = getCaretRect(editor);
  const fallbackRect = editor.getBoundingClientRect();
  return caretRect
    ? getPopupPositionFromRect(caretRect)
    : getPopupPositionFromRect(fallbackRect);
}

/**
 * Measures and tracks the fixed-portal position for `ComposerWysiwygEditor`'s
 * suggestion listbox. Uses a layout effect for immediate open/typing placement
 * (before paint, keeping `getCaretRect`'s DOM fallback out of render) and a
 * passive effect for viewport resize/scroll listeners and the 2-frame settle.
 */
export function useComposerSuggestionPopupPosition(
  editor: HTMLElement | null,
  suggestion: ComposerSuggestion | null,
): TriggerPosition | null {
  const [position, setPosition] = useState<TriggerPosition | null>(null);
  const isOpenRef = useRef(false);
  const suggestionKind = suggestion?.kind ?? null;

  useLayoutEffect(() => {
    if (!editor || !suggestion) {
      isOpenRef.current = false;
      setPosition(null);
      return;
    }
    isOpenRef.current = true;
    setPosition(measureSuggestionPopupPosition(editor, suggestion.kind));
    return () => {
      isOpenRef.current = false;
    };
  }, [editor, suggestion]);

  useEffect(() => {
    if (!editor || !suggestionKind) return;

    let active = true;
    const updatePosition = () => {
      if (!active || !isOpenRef.current) return;
      setPosition(measureSuggestionPopupPosition(editor, suggestionKind));
    };

    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener("resize", updatePosition);
    visualViewport?.addEventListener("scroll", updatePosition);
    window.addEventListener("resize", updatePosition);
    let nestedRafId = 0;
    const rafId = requestAnimationFrame(() => {
      nestedRafId = requestAnimationFrame(updatePosition);
    });

    return () => {
      active = false;
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(nestedRafId);
      visualViewport?.removeEventListener("resize", updatePosition);
      visualViewport?.removeEventListener("scroll", updatePosition);
      window.removeEventListener("resize", updatePosition);
    };
  }, [editor, suggestionKind]);

  return suggestion ? position : null;
}
