"use client";

import { useRouter } from "next/navigation";

import { useMountEffect } from "@/hooks/use-mount-effect";
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
 * Keeps the Auto time format in step with the browser's. The server cannot
 * see the browser's hour cycle, so a request without the detected cookie
 * renders the language default; once mounted, the browser records its own and
 * refreshes so server output follows it. An explicit choice outranks Auto, so
 * the value is still recorded but the refresh would change nothing.
 */
export function TimeFormatSync() {
  const router = useRouter();

  useMountEffect(() => {
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
    router.refresh();
  });

  return null;
}
