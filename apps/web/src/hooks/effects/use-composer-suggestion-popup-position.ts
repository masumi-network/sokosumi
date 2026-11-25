"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import type { ComposerSuggestion } from "@/components/chat/composer-suggestions";
import { ROOM_COMPOSER_MENTION_ANCHOR_ATTR } from "@/components/chat/room-message-composer";
import {
  getCaretRect,
  getMentionPopupPositionFromAnchorRect,
  getPopupPositionFromRect,
  type TriggerPosition,
} from "@/components/ui/mention-textarea-utils";

function noopSubscribe(): () => void {
  return () => {};
}

function getServerSnapshot(): string | null {
  return null;
}

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

function serializePositionSnapshot(
  position: TriggerPosition,
  innerHeight: number,
): string {
  // Include innerHeight because top-side fixed styles compute
  // `bottom = window.innerHeight - position.top` during render.
  return `${position.top}|${position.left}|${position.side}|${position.maxHeight}|${position.width ?? ""}|${innerHeight}`;
}

function parsePositionSnapshot(snapshot: string): TriggerPosition {
  const [top, left, side, maxHeight, width] = snapshot.split("|");
  const position: TriggerPosition = {
    top: Number(top),
    left: Number(left),
    side: side === "top" ? "top" : "bottom",
    maxHeight: Number(maxHeight),
  };
  if (width !== "") {
    position.width = Number(width);
  }
  return position;
}

/**
 * Measures the fixed-portal placement for `ComposerWysiwygEditor`'s suggestion
 * listbox from DOM and visualViewport geometry. Subscribes to viewport resize/scroll
 * plus a 2-frame settle (for iOS keyboard/layout shifts) while open.
 */
export function useComposerSuggestionPopupPosition(
  editor: HTMLElement | null,
  suggestionKind: ComposerSuggestion["kind"] | null,
): TriggerPosition | null {
  const isActive = editor !== null && suggestionKind !== null;

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!isActive) return noopSubscribe();

      const visualViewport = window.visualViewport;
      visualViewport?.addEventListener("resize", onStoreChange);
      visualViewport?.addEventListener("scroll", onStoreChange);
      window.addEventListener("resize", onStoreChange);

      let nestedRafId = 0;
      const rafId = requestAnimationFrame(() => {
        nestedRafId = requestAnimationFrame(onStoreChange);
      });

      return () => {
        cancelAnimationFrame(rafId);
        cancelAnimationFrame(nestedRafId);
        visualViewport?.removeEventListener("resize", onStoreChange);
        visualViewport?.removeEventListener("scroll", onStoreChange);
        window.removeEventListener("resize", onStoreChange);
      };
    },
    // Re-subscribe when kind changes so the 2-frame settle matches main's
    // `[isOpen, suggestionKind]` effect lifecycle.
    [editor, isActive, suggestionKind],
  );

  const getSnapshot = useCallback((): string | null => {
    if (!editor || !suggestionKind) return null;
    const measured = measureSuggestionPopupPosition(editor, suggestionKind);
    return serializePositionSnapshot(measured, window.innerHeight);
  }, [editor, suggestionKind]);

  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  return useMemo(
    () => (snapshot ? parsePositionSnapshot(snapshot) : null),
    [snapshot],
  );
}
