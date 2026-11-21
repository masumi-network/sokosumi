"use client";

import { useEffect } from "react";

/** Toasts rise from the same corner: this keeps them over the button (its height plus both gaps). */
const SEO_TOAST_BOTTOM_OFFSET = "76px";

/**
 * Sets `--toast-bottom-offset` on `document.documentElement` while the SEO
 * ask button is mounted so toasts clear it, removing the property on cleanup.
 */
export function useSeoAskButtonToastOffset(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--toast-bottom-offset", SEO_TOAST_BOTTOM_OFFSET);
    return () => {
      root.style.removeProperty("--toast-bottom-offset");
    };
  }, []);
}
