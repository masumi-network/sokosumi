"use client";

import { useEffect, useLayoutEffect } from "react";

export interface FocusableElement {
  focus(options?: FocusOptions): void;
}

export interface UseFocusWhenOptions {
  /** Passed to `element.focus({ preventScroll })`. */
  preventScroll?: boolean;
  /** Defers focus to `requestAnimationFrame` and cancels on cleanup. */
  deferToFrame?: boolean;
  /** Re-runs focus when this value changes while `when` stays true. */
  resetKey?: unknown;
}

function applyFocus(
  target: FocusableElement,
  preventScroll: boolean | undefined,
): void {
  if (preventScroll === undefined) {
    target.focus();
  } else {
    target.focus({ preventScroll });
  }
}

/**
 * Focuses a live element when `when` is true, with optional pre-scroll
 * suppression, animation-frame deferral, and `resetKey` re-triggering.
 */
export function useFocusWhen(
  target: FocusableElement | null | undefined,
  when: boolean,
  options?: UseFocusWhenOptions,
): void {
  const preventScroll = options?.preventScroll;
  const deferToFrame = options?.deferToFrame ?? false;
  const resetKey = options?.resetKey;

  useEffect(() => {
    void resetKey;
    if (!when || !target) return;

    if (!deferToFrame) {
      applyFocus(target, preventScroll);
      return;
    }

    const frame = requestAnimationFrame(() => {
      applyFocus(target, preventScroll);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [target, when, preventScroll, deferToFrame, resetKey]);
}

/**
 * Layout-effect variant of `useFocusWhen` for pre-paint focus.
 */
export function useLayoutFocusWhen(
  target: FocusableElement | null | undefined,
  when: boolean,
  options?: Omit<UseFocusWhenOptions, "deferToFrame">,
): void {
  const preventScroll = options?.preventScroll;
  const resetKey = options?.resetKey;

  useLayoutEffect(() => {
    void resetKey;
    if (!when || !target) return;
    applyFocus(target, preventScroll);
  }, [target, when, preventScroll, resetKey]);
}
