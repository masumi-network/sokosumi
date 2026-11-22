"use client";

import { useEffect, useRef } from "react";

/**
 * Focuses the `EmailCodeField` input once after a refusal once the field is no
 * longer locked, running after every render to match `useEmailCodeRefusal`.
 */
export function useEmailCodeRefusalFocus(
  focus: () => void,
  isLocked: boolean,
): () => void {
  const focusPending = useRef(false);

  // Runs after every render, and focuses once per refusal when unlocked.
  useEffect(() => {
    if (!focusPending.current || isLocked) return;
    focusPending.current = false;
    focus();
  });

  return () => {
    focusPending.current = true;
  };
}
