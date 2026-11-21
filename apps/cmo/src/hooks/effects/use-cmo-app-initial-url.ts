"use client";

import { useEffect } from "react";

import { VIEW_PATHS, type View } from "../../lib/views";

/**
 * Replaces a query-bearing redirect URL with `initialView`'s canonical path in
 * `CmoApp`.
 */
export function useCmoAppInitialUrl(initialView: View): void {
  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState(null, "", VIEW_PATHS[initialView]);
    }
  }, [initialView]);
}
