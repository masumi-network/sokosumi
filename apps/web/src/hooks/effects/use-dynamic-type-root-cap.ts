"use client";

import { useEffect } from "react";

import { useEventListener } from "@/hooks/effects/use-event-listener";
import { applyDynamicTypeRootCap } from "@/lib/utils/dynamic-type";

/**
 * Applies the Apple Dynamic Type root `fontSize` cap on mount, restores the
 * previous inline root `fontSize` on cleanup, and re-applies when the page
 * returns from bfcache (`pageshow`) or becomes visible again.
 */
export function useDynamicTypeRootCap(): void {
  useEffect(() => {
    const root = document.documentElement;
    const previousFontSize = root.style.fontSize;
    applyDynamicTypeRootCap(root);

    return () => {
      root.style.fontSize = previousFontSize;
    };
  }, []);

  useEventListener("window", "pageshow", () => {
    applyDynamicTypeRootCap();
  });

  useEventListener("document", "visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    applyDynamicTypeRootCap();
  });
}
