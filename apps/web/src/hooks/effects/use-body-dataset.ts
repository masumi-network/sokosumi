"use client";

import { useEffect } from "react";

import { createDomPropertyStack } from "./dom-property-stack";

const claimBodyDataset = createDomPropertyStack<string | undefined>({
  read: (key) => document.body.dataset[key],
  write: (key, value) => {
    if (value === undefined) {
      delete document.body.dataset[key];
    } else {
      document.body.dataset[key] = value;
    }
  },
});

/**
 * Sets `document.body.dataset[key]` while mounted (and while visible under
 * React `<Activity>`), preserving overlapping owners and restoring the
 * previous value on cleanup or when `value` is nullish.
 */
export function useBodyDataset(
  key: string,
  value: string | null | undefined,
): void {
  useEffect(() => {
    if (value == null) return;
    return claimBodyDataset(key, value);
  }, [key, value]);
}
