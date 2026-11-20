"use client";

import {
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
} from "react";

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
 * Focuses `targetRef.current` when `when` is true, reading the ref at effect
 * time so node remounts never re-trigger focus while the trigger is unchanged.
 */
export function useFocusWhen(
  targetRef: RefObject<FocusableElement | null>,
  when: boolean,
  options?: UseFocusWhenOptions,
): void {
  const getTarget = useEffectEvent(() => targetRef.current);
  const preventScroll = options?.preventScroll;
  const deferToFrame = options?.deferToFrame ?? false;
  const resetKey = options?.resetKey;

  useEffect(() => {
    void resetKey;
    if (!when) return;

    if (!deferToFrame) {
      const target = getTarget();
      if (target) applyFocus(target, preventScroll);
      return;
    }

    const frame = requestAnimationFrame(() => {
      const target = getTarget();
      if (target) applyFocus(target, preventScroll);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [when, preventScroll, deferToFrame, resetKey]);
}

/**
 * Layout-effect variant of `useFocusWhen` for pre-paint focus.
 */
export function useLayoutFocusWhen(
  targetRef: RefObject<FocusableElement | null>,
  when: boolean,
  options?: Omit<UseFocusWhenOptions, "deferToFrame">,
): void {
  const getTarget = useEffectEvent(() => targetRef.current);
  const preventScroll = options?.preventScroll;
  const resetKey = options?.resetKey;

  useLayoutEffect(() => {
    void resetKey;
    if (!when) return;
    const target = getTarget();
    if (target) applyFocus(target, preventScroll);
  }, [when, preventScroll, resetKey]);
}
