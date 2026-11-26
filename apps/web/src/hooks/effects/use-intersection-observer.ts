"use client";

import { useEffect, useEffectEvent } from "react";

export interface UseIntersectionObserverOptions {
  root?: Element | Document | null;
  rootMargin?: string;
  threshold?: number | readonly number[];
  /** Re-subscribes the observer when this value changes (e.g. re-arming a sentinel). */
  resetKey?: unknown;
}

/**
 * Observes a live element with `IntersectionObserver`, disconnects on unmount
 * or target change, and ignores queued entries delivered after disconnect or
 * for a replaced target.
 */
export function useIntersectionObserver(
  target: Element | null | undefined,
  onIntersect: (
    entries: IntersectionObserverEntry[],
    observer: IntersectionObserver,
  ) => void,
  options?: UseIntersectionObserverOptions,
): void {
  const handleIntersect = useEffectEvent(onIntersect);
  const root = options?.root;
  const rootMargin = options?.rootMargin;
  const threshold = options?.threshold;
  const thresholdKey: string | number | undefined = Array.isArray(threshold)
    ? threshold.join(",")
    : (threshold as number | undefined);
  const resetKey = options?.resetKey;

  useEffect(() => {
    void resetKey;
    if (!target || typeof IntersectionObserver === "undefined") {
      return;
    }

    const parsedThreshold =
      thresholdKey === undefined
        ? undefined
        : typeof thresholdKey === "number"
          ? thresholdKey
          : thresholdKey.split(",").map(Number);

    let init: IntersectionObserverInit | undefined;
    if (
      root !== undefined ||
      rootMargin !== undefined ||
      parsedThreshold !== undefined
    ) {
      init = {};
      if (root !== undefined) init.root = root;
      if (rootMargin !== undefined) init.rootMargin = rootMargin;
      if (parsedThreshold !== undefined) init.threshold = parsedThreshold;
    }

    let active = true;
    const dispatch: IntersectionObserverCallback = (entries, obs) => {
      if (!active) return;
      const relevant = entries.filter(
        (entry) => !entry.target || entry.target === target,
      );
      if (relevant.length === 0) return;
      handleIntersect(relevant, obs);
    };

    const observer =
      init === undefined
        ? new IntersectionObserver(dispatch)
        : new IntersectionObserver(dispatch, init);

    observer.observe(target);
    return () => {
      active = false;
      observer.takeRecords();
      observer.disconnect();
    };
  }, [target, root, rootMargin, thresholdKey, resetKey]);
}
