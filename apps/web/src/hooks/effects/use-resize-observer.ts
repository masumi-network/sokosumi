"use client";

import { useEffect, useEffectEvent, useLayoutEffect } from "react";

export type ResizeObserverSingleTarget = Element | { selector: string };

export type ResizeObserverTarget =
  | ResizeObserverSingleTarget
  | readonly (ResizeObserverSingleTarget | null | undefined)[]
  | null
  | undefined;

export interface UseResizeObserverOptions {
  /** Calls `onResize([])` synchronously when observation starts or `resetKey` changes. */
  immediate?: boolean;
  /** Also observes each direct child element of every resolved target. */
  observeChildren?: boolean;
  /** Coalesces burst resize notifications into one `requestAnimationFrame` callback. */
  coalesceFrame?: boolean;
  /** Re-runs observation (and `immediate` measurement) when this value changes. */
  resetKey?: unknown;
  /** Passed to `observer.observe(element, observerOptions)`. */
  observerOptions?: ResizeObserverOptions;
}

function resolveSingleTarget(
  target: ResizeObserverSingleTarget | null | undefined,
): Element | null {
  if (!target) return null;
  if ("selector" in target) {
    if (typeof document === "undefined") return null;
    return document.querySelector(target.selector);
  }
  return target;
}

function resolveTargets(
  elementTarget:
    | Element
    | readonly (ResizeObserverSingleTarget | null | undefined)[]
    | null
    | undefined,
  selector: string | null,
): Element[] {
  if (selector !== null) {
    if (typeof document === "undefined") return [];
    const matched = document.querySelector(selector);
    return matched ? [matched] : [];
  }
  if (!elementTarget) return [];
  if (Array.isArray(elementTarget)) {
    const resolved: Element[] = [];
    for (const entry of elementTarget) {
      const element = resolveSingleTarget(entry);
      if (element) resolved.push(element);
    }
    return resolved;
  }
  return [elementTarget as Element];
}

function splitTarget(target: ResizeObserverTarget): {
  elementTarget:
    | Element
    | readonly (ResizeObserverSingleTarget | null | undefined)[]
    | null
    | undefined;
  selector: string | null;
} {
  if (
    target &&
    !Array.isArray(target) &&
    typeof target === "object" &&
    "selector" in target
  ) {
    return { elementTarget: null, selector: target.selector };
  }
  return {
    elementTarget: target as
      | Element
      | readonly (ResizeObserverSingleTarget | null | undefined)[]
      | null
      | undefined,
    selector: null,
  };
}

function attachResizeObserver(
  targets: Element[],
  handleResize: (entries: ResizeObserverEntry[]) => void,
  {
    immediate,
    observeChildren,
    coalesceFrame,
    box,
  }: {
    immediate: boolean;
    observeChildren: boolean;
    coalesceFrame: boolean;
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

  let frame: number | undefined;
  const observer = new ResizeObserver((entries) => {
    if (!coalesceFrame) {
      handleResize(entries);
      return;
    }
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
    }
    frame = requestAnimationFrame(() => {
      frame = undefined;
      handleResize(entries);
    });
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
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
    }
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
  const { elementTarget, selector } = splitTarget(target);
  const immediate = options?.immediate ?? false;
  const observeChildren = options?.observeChildren ?? false;
  const coalesceFrame = options?.coalesceFrame ?? false;
  const resetKey = options?.resetKey;
  const box = options?.observerOptions?.box;

  useEffect(() => {
    void resetKey;
    return attachResizeObserver(
      resolveTargets(elementTarget, selector),
      handleResize,
      { immediate, observeChildren, coalesceFrame, box },
    );
  }, [
    elementTarget,
    selector,
    immediate,
    observeChildren,
    coalesceFrame,
    resetKey,
    box,
  ]);
}

/**
 * Layout-effect variant of `useResizeObserver` for pre-paint measurement (for
 * example overflow disclosure or docked layout slots).
 */
export function useLayoutResizeObserver(
  target: ResizeObserverTarget,
  onResize: (entries: ResizeObserverEntry[]) => void,
  options?: UseResizeObserverOptions,
): void {
  const handleResize = useEffectEvent(onResize);
  const { elementTarget, selector } = splitTarget(target);
  const immediate = options?.immediate ?? false;
  const observeChildren = options?.observeChildren ?? false;
  const coalesceFrame = options?.coalesceFrame ?? false;
  const resetKey = options?.resetKey;
  const box = options?.observerOptions?.box;

  useLayoutEffect(() => {
    void resetKey;
    return attachResizeObserver(
      resolveTargets(elementTarget, selector),
      handleResize,
      { immediate, observeChildren, coalesceFrame, box },
    );
  }, [
    elementTarget,
    selector,
    immediate,
    observeChildren,
    coalesceFrame,
    resetKey,
    box,
  ]);
}
