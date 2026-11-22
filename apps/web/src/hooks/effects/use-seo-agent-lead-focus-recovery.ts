"use client";

import { type RefObject, useEffect, useRef } from "react";

/**
 * Tracks whether focus was inside the SEO Agent lead step list and moves focus
 * to the verdict heading when `leadKey` changes and focus fell to `document.body`.
 */
export function useSeoAgentLeadFocusRecovery(
  verdict: RefObject<HTMLHeadingElement | null>,
  leadKey: string | null,
): RefObject<boolean> {
  // Only focus that was in the list of steps counts: a page nobody has entered also has its focus on the body.
  const leadSeen = useRef(leadKey);
  const leadFocused = useRef(false);
  useEffect(() => {
    if (leadSeen.current === leadKey) return;
    leadSeen.current = leadKey;
    if (leadFocused.current && document.activeElement === document.body)
      verdict.current?.focus();
    leadFocused.current = false;
  }, [leadKey]);
  return leadFocused;
}
