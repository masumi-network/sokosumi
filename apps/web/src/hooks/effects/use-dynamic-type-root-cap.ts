"use client";

import { useEffect } from "react";

import { applyDynamicTypeRootCap } from "@/lib/utils/dynamic-type";

/**
 * Applies the Apple Dynamic Type root `fontSize` cap on mount and re-applies
 * it when the page returns from bfcache (`pageshow`) or becomes visible again.
 */
export function useDynamicTypeRootCap(): void {
  useEffect(() => {
    applyDynamicTypeRootCap();

    function handlePageshow() {
      applyDynamicTypeRootCap();
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      applyDynamicTypeRootCap();
    }

    window.addEventListener("pageshow", handlePageshow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", handlePageshow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
}
