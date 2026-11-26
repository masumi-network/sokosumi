"use client";

import { type RefObject, useEffect } from "react";

/**
 * Moves focus to the SEO Agent verdict heading when a check that ran during
 * this visit ends and focus fell to `document.body`.
 */
export function useSeoAgentVerdictFocus(
  verdict: RefObject<HTMLHeadingElement | null>,
  checkSeen: boolean,
  checkRunning: boolean,
): void {
  useEffect(() => {
    if (checkSeen && !checkRunning && document.activeElement === document.body)
      verdict.current?.focus();
  }, [checkSeen, checkRunning]);
}
