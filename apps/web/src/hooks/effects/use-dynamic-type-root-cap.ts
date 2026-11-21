"use client";

import { useEffect } from "react";

import { useEventListener } from "@/hooks/effects/use-event-listener";
import { applyDynamicTypeRootCap } from "@/lib/utils/dynamic-type";

/**
 * Applies the Apple Dynamic Type root `fontSize` cap on mount and re-applies
 * it when the page returns from bfcache (`pageshow`) or becomes visible again.
 */
export function useDynamicTypeRootCap(): void {
  useEffect(() => {
    applyDynamicTypeRootCap();
  }, []);

  useEventListener("window", "pageshow", () => {
    applyDynamicTypeRootCap();
  });

  useEventListener("document", "visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    applyDynamicTypeRootCap();
  });
}
