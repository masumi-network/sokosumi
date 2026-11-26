"use client";

import { useCallback, useEffect, useState } from "react";

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
 * Owns the measured fixed-portal position for `ComposerWysiwygEditor`'s
 * suggestion listbox. Callers invoke `place` in the same event handler that
 * opens or updates suggestions so the measured position commits with the first
 * portal render, while the passive effect tracks viewport resize/scroll and
 * runs the 2-frame settle.
 */
export function useComposerSuggestionPopupPosition(
  editor: HTMLElement | null,
  isOpen: boolean,
  suggestionKind: ComposerSuggestion["kind"] | null,
): {
  position: TriggerPosition | null;
  place: (target: HTMLElement, kind: ComposerSuggestion["kind"]) => void;
} {
  const [position, setPosition] = useState<TriggerPosition | null>(null);

  const place = useCallback(
    (target: HTMLElement, kind: ComposerSuggestion["kind"]) => {
      setPosition(measureSuggestionPopupPosition(target, kind));
    },
    [],
  );

  useEffect(() => {
    if (!isOpen || !editor || !suggestionKind) return;

    let active = true;
    const updatePosition = () => {
      if (!active) return;
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
  }, [editor, isOpen, suggestionKind]);

  return {
    position: isOpen ? position : null,
    place,
  };
}
