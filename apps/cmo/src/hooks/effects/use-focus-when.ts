"use client";

import { type RefObject, useEffect, useEffectEvent } from "react";

export interface FocusableElement {
  focus(options?: FocusOptions): void;
}

export type FocusTarget =
  | RefObject<FocusableElement | null>
  | (() => FocusableElement | null | undefined);

export interface UseFocusWhenOptions {
  /** Re-runs focus when this value changes while `when` stays true. */
  resetKey?: unknown;
}

/**
 * Focuses the resolved target when `when` is true, reading the ref or getter at
 * effect time so node remounts never re-trigger focus while the trigger is
 * unchanged.
 */
export function useFocusWhen(
  target: FocusTarget,
  when: boolean,
  options?: UseFocusWhenOptions,
): void {
  const getTarget = useEffectEvent(() =>
    typeof target === "function" ? target() : target.current,
  );
  const resetKey = options?.resetKey;

  useEffect(() => {
    void resetKey;
    if (!when) return;
    getTarget()?.focus();
  }, [when, resetKey]);
}
