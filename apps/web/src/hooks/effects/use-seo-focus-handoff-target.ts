"use client";

import { type RefObject, useEffect } from "react";

/**
 * Moves focus to the SEO focus-handoff status target when a handoff is armed,
 * the line is visible, and focus fell to `document.body`.
 */
export function useSeoFocusHandoffTarget(
  handoff: RefObject<boolean>,
  target: RefObject<HTMLParagraphElement | null>,
  key: unknown,
  hidden: boolean,
): void {
  useEffect(() => {
    if (!handoff.current || hidden) return;
    handoff.current = false;
    // The page stays where the reader scrolled it.
    if (document.activeElement === document.body)
      target.current?.focus({ preventScroll: true });
  }, [key, hidden]);
}
