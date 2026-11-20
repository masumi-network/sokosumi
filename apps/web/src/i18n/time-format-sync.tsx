"use client";

import { useBrowserTimeFormatSync } from "@/hooks/effects/use-browser-time-format-sync";

/**
 * Keeps the Auto time format in step with the browser's. The server cannot
 * see the browser's hour cycle, so a request without the detected cookie
 * renders the language default; once mounted, the browser records its own and
 * refreshes so server output follows it. An explicit choice outranks Auto, so
 * the value is still recorded but the refresh would change nothing.
 */
export function TimeFormatSync() {
  useBrowserTimeFormatSync();

  return null;
}
