"use client";

import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useState,
} from "react";
import {
  parseSidebarWidthCookieHeader,
  SIDEBAR_DEFAULT_WIDTH,
} from "@/lib/ui-preferences/sidebar-state";

export function readSidebarWidth(): number {
  return (
    parseSidebarWidthCookieHeader(document.cookie) ?? SIDEBAR_DEFAULT_WIDTH
  );
}

export interface UseSidebarEdgeWidthLifecycleResult {
  width: number;
  setWidth: Dispatch<SetStateAction<number>>;
}

/**
 * Hydrates `SidebarEdgeHandle`'s splitter `width` from the browser cookie on
 * mount and clears any pending slide-out timer and `data-resizing` attribute
 * on unmount.
 */
export function useSidebarEdgeWidthLifecycle(
  ref: RefObject<HTMLDivElement | null>,
  restoreTimer: RefObject<ReturnType<typeof setTimeout> | number | null>,
): UseSidebarEdgeWidthLifecycleResult {
  // What the splitter reports; the width itself lives on `<html>` while
  // dragging, so a move never re-renders.
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH);

  // Leaving mid-drag or mid-slide must not strand `data-resizing` on the
  // wrapper or a timer that writes to a document nobody is dragging.
  useEffect(() => {
    // The stored width, for the splitter's value: the cookie is not there on
    // the server.
    setWidth(readSidebarWidth());
    const node = ref.current;
    return () => {
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
      node
        ?.closest('[data-slot="sidebar-wrapper"]')
        ?.removeAttribute("data-resizing");
    };
  }, []);

  return { width, setWidth };
}
