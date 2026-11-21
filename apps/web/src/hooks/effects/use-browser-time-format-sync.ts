"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent } from "react";

import {
  DETECTED_TIME_FORMAT_COOKIE_NAME,
  detectBrowserTimeFormat,
  readTimeFormatCookie,
  serializeDetectedTimeFormatCookie,
  TIME_FORMAT_COOKIE_NAME,
} from "@/i18n/time-format";

function readDetectedTimeFormat() {
  return readTimeFormatCookie(
    document.cookie,
    DETECTED_TIME_FORMAT_COOKIE_NAME,
  );
}

/**
 * Records the browser's detected 12h/24h time format in a cookie on mount and
 * refreshes the route when Auto time formatting is active and the cookie stuck.
 */
export function useBrowserTimeFormatSync(): void {
  const router = useRouter();
  const refreshRouter = useEffectEvent(() => {
    router.refresh();
  });

  useEffect(() => {
    const browserTimeFormat = detectBrowserTimeFormat();
    if (readDetectedTimeFormat() === browserTimeFormat) {
      return;
    }
    document.cookie = serializeDetectedTimeFormatCookie(browserTimeFormat);
    const rendersAuto =
      readTimeFormatCookie(document.cookie, TIME_FORMAT_COOKIE_NAME) === null;
    if (!rendersAuto || readDetectedTimeFormat() !== browserTimeFormat) {
      return;
    }
    refreshRouter();
  }, []);
}
