"use client";

import { useEffect } from "react";

import { createDomPropertyStack } from "./dom-property-stack";

const claimRootCssVariable = createDomPropertyStack<string | null>({
  read: (name) => {
    const value = document.documentElement.style.getPropertyValue(name);
    return value === "" ? null : value;
  },
  write: (name, value) => {
    if (value === null) {
      document.documentElement.style.removeProperty(name);
    } else {
      document.documentElement.style.setProperty(name, value);
    }
  },
});

/**
 * Sets a CSS custom property on `document.documentElement` while mounted
 * (and while visible under React `<Activity>`), preserving overlapping owners
 * and restoring the previous value on cleanup or when `value` is nullish.
 */
export function useRootCssVariable(
  name: string,
  value: string | null | undefined,
): void {
  useEffect(() => {
    if (value == null) return;
    return claimRootCssVariable(name, value);
  }, [name, value]);
}
