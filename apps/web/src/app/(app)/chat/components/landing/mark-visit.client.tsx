"use client";

import { useEffect, useRef } from "react";

import { markVisitAction } from "@/app/chat/actions";
import { useIsMobileMedia } from "@/hooks/use-mobile";

interface MarkVisitProps {
  /**
   * Which breakpoint actually shows the welcome. Both surfaces render behind a
   * CSS breakpoint, and `md:hidden` still mounts on the other side, so the
   * media query — not mere mounting — is what proves the user saw it.
   */
  on: "desktop" | "mobile";
  /**
   * Server's verdict: the summary loaded and the recorded visit is old enough
   * to move. False whenever Core failed, so a failed read never discards the
   * window it could not report on.
   */
  shouldAdvance: boolean;
}

/**
 * Records the visit that the "since your last visit" window is measured from.
 *
 * Deliberately client-side. Stamping during the server render moved the window
 * for anyone whose request merely rendered the markup — a mobile request to
 * bare `/chat` that immediately redirects away, or a desktop request to the
 * mobile-only chats route — burning a summary nobody was shown.
 */
export function MarkVisit({ on, shouldAdvance }: MarkVisitProps) {
  const isMobile = useIsMobileMedia();
  const hasMarked = useRef(false);

  useEffect(() => {
    if (!shouldAdvance || hasMarked.current) {
      return;
    }
    // Undefined until the media query resolves; committing then would guess.
    if (isMobile === undefined) {
      return;
    }
    if ((on === "mobile") !== isMobile) {
      return;
    }

    hasMarked.current = true;
    // Best effort: the greeting is already rendered, and a failed stamp only
    // means the next visit reports a slightly wider window.
    void markVisitAction().catch(() => {});
  }, [isMobile, on, shouldAdvance]);

  return null;
}
