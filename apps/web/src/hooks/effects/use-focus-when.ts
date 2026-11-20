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

export type FocusTarget =
  | RefObject<FocusableElement | null>
  | (() => FocusableElement | null | undefined);

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
  const preventScroll = options?.preventScroll;
  const deferToFrame = options?.deferToFrame ?? false;
  const resetKey = options?.resetKey;

  useEffect(() => {
    void resetKey;
    if (!when) return;

    if (!deferToFrame) {
      const element = getTarget();
      if (element) applyFocus(element, preventScroll);
      return;
    }

    const frame = requestAnimationFrame(() => {
      const element = getTarget();
      if (element) applyFocus(element, preventScroll);
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
  target: FocusTarget,
  when: boolean,
  options?: Omit<UseFocusWhenOptions, "deferToFrame">,
): void {
  const getTarget = useEffectEvent(() =>
    typeof target === "function" ? target() : target.current,
  );
  const preventScroll = options?.preventScroll;
  const resetKey = options?.resetKey;

  useLayoutEffect(() => {
    void resetKey;
    if (!when) return;
    const element = getTarget();
    if (element) applyFocus(element, preventScroll);
  }, [when, preventScroll, resetKey]);
}
