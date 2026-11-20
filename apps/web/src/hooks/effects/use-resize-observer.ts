"use client";

import { useEffect, useEffectEvent, useLayoutEffect } from "react";

export type ResizeObserverTarget =
  | Element
  | readonly (Element | null | undefined)[]
  | null
  | undefined;

export interface UseResizeObserverOptions {
  /** Calls `onResize([])` synchronously when observation starts or `resetKey` changes. */
  immediate?: boolean;
  /** Also observes each direct child element of every target. */
  observeChildren?: boolean;
  /** Re-runs observation (and `immediate` measurement) when this value changes. */
  resetKey?: unknown;
  /** Passed to `observer.observe(element, observerOptions)`. */
  observerOptions?: ResizeObserverOptions;
}

function resolveTargets(target: ResizeObserverTarget): Element[] {
  if (!target) return [];
  if (Array.isArray(target)) {
    const resolved: Element[] = [];
    for (const element of target) {
      if (element) resolved.push(element);
    }
    return resolved;
  }
  return [target as Element];
}

function attachResizeObserver(
  targets: Element[],
  handleResize: (entries: ResizeObserverEntry[]) => void,
  {
    immediate,
    observeChildren,
    box,
  }: {
    immediate: boolean;
    observeChildren: boolean;
    box: ResizeObserverBoxOptions | undefined;
  },
): (() => void) | undefined {
  if (targets.length === 0) return undefined;

  if (immediate) {
    handleResize([]);
  }

  if (typeof ResizeObserver === "undefined") {
    return undefined;
  }

  const observer = new ResizeObserver((entries) => {
    handleResize(entries);
  });

  const observerOptions = box ? { box } : undefined;
  for (const element of targets) {
    if (observerOptions) {
      observer.observe(element, observerOptions);
    } else {
      observer.observe(element);
    }
    if (observeChildren) {
      for (const child of element.children) {
        if (observerOptions) {
          observer.observe(child, observerOptions);
        } else {
          observer.observe(child);
        }
      }
    }
  }

  return () => {
    observer.disconnect();
  };
}

/**
 * Observes one or more live elements with `ResizeObserver` and disconnects on
 * unmount or target change. Array targets should keep a stable reference
 * (state or `useMemo`) to avoid re-subscribing on unrelated renders.
 */
export function useResizeObserver(
  target: ResizeObserverTarget,
  onResize: (entries: ResizeObserverEntry[]) => void,
  options?: UseResizeObserverOptions,
): void {
  const handleResize = useEffectEvent(onResize);
  const immediate = options?.immediate ?? false;
  const observeChildren = options?.observeChildren ?? false;
  const resetKey = options?.resetKey;
  const box = options?.observerOptions?.box;

  useEffect(() => {
    void resetKey;
    return attachResizeObserver(resolveTargets(target), handleResize, {
      immediate,
      observeChildren,
      box,
    });
  }, [target, immediate, observeChildren, resetKey, box]);
}

/**
 * Layout-effect variant of `useResizeObserver` for pre-paint measurement (for
 * example overflow disclosure).
 */
export function useLayoutResizeObserver(
  target: ResizeObserverTarget,
  onResize: (entries: ResizeObserverEntry[]) => void,
  options?: UseResizeObserverOptions,
): void {
  const handleResize = useEffectEvent(onResize);
  const immediate = options?.immediate ?? false;
  const observeChildren = options?.observeChildren ?? false;
  const resetKey = options?.resetKey;
  const box = options?.observerOptions?.box;

  useLayoutEffect(() => {
    void resetKey;
    return attachResizeObserver(resolveTargets(target), handleResize, {
      immediate,
      observeChildren,
      box,
    });
  }, [target, immediate, observeChildren, resetKey, box]);
}
