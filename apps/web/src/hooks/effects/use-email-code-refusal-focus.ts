"use client";

import { type RefObject, useEffect } from "react";

/**
 * Focuses the `EmailCodeField` input once after a refusal once the field is no
 * longer locked, running after every render to match `useEmailCodeRefusal`.
 */
export function useEmailCodeRefusalFocus(
  focusPending: RefObject<boolean>,
  focus: () => void,
  isLocked: boolean,
): void {
  // Runs after every render, and focuses once per refusal when unlocked.
  useEffect(() => {
    if (!focusPending.current || isLocked) return;
    focusPending.current = false;
    focus();
  });
}
