"use client";

import { useEffect, useEffectEvent, useLayoutEffect } from "react";

export type MutationObserverTarget =
  | "documentElement"
  | "body"
  | Node
  | null
  | undefined;

export interface UseMutationObserverOptions {
  /** Passed to `observer.observe(node, init)`. */
  init: MutationObserverInit;
  /** Calls `onMutate([])` synchronously when observation starts or `resetKey` changes. */
  immediate?: boolean;
  /** Re-runs observation (and `immediate` callback) when this value changes. */
  resetKey?: unknown;
}

function resolveTarget(target: MutationObserverTarget): Node | null {
  if (!target) return null;
  if (target === "body") {
    return typeof document === "undefined" ? null : document.body;
  }
  if (target === "documentElement") {
    return typeof document === "undefined" ? null : document.documentElement;
  }
  return target;
}

function attachMutationObserver(
  target: MutationObserverTarget,
  handleMutate: (records: MutationRecord[]) => void,
  {
    attributes,
    attributeOldValue,
    attributeFilterKey,
    characterData,
    characterDataOldValue,
    childList,
    subtree,
    immediate,
  }: {
    attributes: boolean | undefined;
    attributeOldValue: boolean | undefined;
    attributeFilterKey: string | undefined;
    characterData: boolean | undefined;
    characterDataOldValue: boolean | undefined;
    childList: boolean | undefined;
    subtree: boolean | undefined;
    immediate: boolean;
  },
): (() => void) | undefined {
  const node = resolveTarget(target);
  if (!node) return undefined;

  if (immediate) {
    handleMutate([]);
  }

  if (typeof MutationObserver === "undefined") {
    return undefined;
  }

  const init: MutationObserverInit = {};
  if (attributes !== undefined) init.attributes = attributes;
  if (attributeOldValue !== undefined)
    init.attributeOldValue = attributeOldValue;
  if (attributeFilterKey !== undefined) {
    init.attributeFilter =
      attributeFilterKey === "" ? [] : attributeFilterKey.split("\0");
  }
  if (characterData !== undefined) init.characterData = characterData;
  if (characterDataOldValue !== undefined)
    init.characterDataOldValue = characterDataOldValue;
  if (childList !== undefined) init.childList = childList;
  if (subtree !== undefined) init.subtree = subtree;

  const observer = new MutationObserver((records) => {
    handleMutate(records);
  });

  observer.observe(node, init);

  return () => {
    observer.disconnect();
  };
}

/**
 * Observes a live DOM node (or `"body"` / `"documentElement"`) with
 * `MutationObserver` and disconnects on unmount or target change.
 */
export function useMutationObserver(
  target: MutationObserverTarget,
  onMutate: (records: MutationRecord[]) => void,
  options: UseMutationObserverOptions,
): void {
  const handleMutate = useEffectEvent(onMutate);
  const {
    attributes,
    attributeOldValue,
    attributeFilter,
    characterData,
    characterDataOldValue,
    childList,
    subtree,
  } = options.init;
  const attributeFilterKey = attributeFilter?.join("\0");
  const immediate = options.immediate ?? false;
  const resetKey = options.resetKey;

  useEffect(() => {
    void resetKey;
    return attachMutationObserver(target, handleMutate, {
      attributes,
      attributeOldValue,
      attributeFilterKey,
      characterData,
      characterDataOldValue,
      childList,
      subtree,
      immediate,
    });
  }, [
    target,
    attributes,
    attributeOldValue,
    attributeFilterKey,
    characterData,
    characterDataOldValue,
    childList,
    subtree,
    immediate,
    resetKey,
  ]);
}

/**
 * Layout-effect variant of `useMutationObserver` for pre-paint DOM slot
 * discovery.
 */
export function useLayoutMutationObserver(
  target: MutationObserverTarget,
  onMutate: (records: MutationRecord[]) => void,
  options: UseMutationObserverOptions,
): void {
  const handleMutate = useEffectEvent(onMutate);
  const {
    attributes,
    attributeOldValue,
    attributeFilter,
    characterData,
    characterDataOldValue,
    childList,
    subtree,
  } = options.init;
  const attributeFilterKey = attributeFilter?.join("\0");
  const immediate = options.immediate ?? false;
  const resetKey = options.resetKey;

  useLayoutEffect(() => {
    void resetKey;
    return attachMutationObserver(target, handleMutate, {
      attributes,
      attributeOldValue,
      attributeFilterKey,
      characterData,
      characterDataOldValue,
      childList,
      subtree,
      immediate,
    });
  }, [
    target,
    attributes,
    attributeOldValue,
    attributeFilterKey,
    characterData,
    characterDataOldValue,
    childList,
    subtree,
    immediate,
    resetKey,
  ]);
}
