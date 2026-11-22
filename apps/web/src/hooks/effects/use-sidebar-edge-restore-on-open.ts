"use client";

import { type RefObject, useEffect, useRef } from "react";
import {
  parseSidebarWidthCookieHeader,
  SIDEBAR_USER_WIDTH_VAR,
} from "@/lib/ui-preferences/sidebar-state";

/**
 * How long the sidebar takes to slide out (`SIDEBAR_HIDE_TRANSITION`), plus a
 * frame: the width it reopens at is put back only after it is out of sight.
 */
const SLIDE_OUT_MS = 250;

export function applySidebarWidth(px: number): void {
  document.documentElement.style.setProperty(SIDEBAR_USER_WIDTH_VAR, `${px}px`);
}

/** Puts back the stored width, or the default when none was ever stored. */
export function applyStoredSidebarWidth(): void {
  const stored = parseSidebarWidthCookieHeader(document.cookie);
  if (stored === null) {
    document.documentElement.style.removeProperty(SIDEBAR_USER_WIDTH_VAR);
  } else {
    applySidebarWidth(stored);
  }
}

export interface UseSidebarEdgeRestoreOnOpenResult {
  restoreTimer: RefObject<ReturnType<typeof setTimeout> | null>;
  restoreNow: () => void;
  restoreAfterSlideOut: () => void;
}

/**
 * Owns `SidebarEdgeHandle`'s post-slide-out width restore timer and cancels
 * it immediately to restore the stored width when the sidebar reopens mid-slide.
 */
export function useSidebarEdgeRestoreOnOpen(
  open: boolean,
): UseSidebarEdgeRestoreOnOpenResult {
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Ends the wait for the slide-out and puts the stored width back now. */
  function restoreNow() {
    if (restoreTimer.current) clearTimeout(restoreTimer.current);
    restoreTimer.current = null;
    applyStoredSidebarWidth();
  }

  /** The narrowed width is for show: restore once the panel is out of sight. */
  function restoreAfterSlideOut() {
    if (restoreTimer.current) clearTimeout(restoreTimer.current);
    restoreTimer.current = setTimeout(restoreNow, SLIDE_OUT_MS);
  }

  // Reopening inside the slide-out window (⌘B, the header toggle) must start
  // from the stored width, not wait for the timer.
  useEffect(() => {
    if (open && restoreTimer.current) restoreNow();
  }, [open]);

  return { restoreTimer, restoreNow, restoreAfterSlideOut };
}
