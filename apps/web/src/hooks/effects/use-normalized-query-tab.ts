"use client";

import { useQueryState } from "nuqs";
import { useCallback, useEffect } from "react";

/**
 * Reads a tab query parameter from the URL, validates it against `enabledTabs`
 * during render, and normalizes an invalid or newly disabled value back to
 * `defaultTab` (clearing the query parameter via nuqs's default `clearOnDefault`).
 */
export function useNormalizedQueryTab<T extends string>(
  key: string,
  enabledTabs: readonly T[],
  defaultTab: T,
): readonly [T, (next: string) => Promise<URLSearchParams> | undefined] {
  const [tab, setTab] = useQueryState(key, {
    defaultValue: defaultTab,
  });

  const isValid = (enabledTabs as readonly string[]).includes(tab);
  const activeTab: T = isValid ? (tab as T) : defaultTab;

  useEffect(() => {
    if (!isValid) {
      void setTab(defaultTab);
    }
  }, [defaultTab, isValid, setTab]);

  const setActiveTab = useCallback(
    (next: string) => {
      if ((enabledTabs as readonly string[]).includes(next)) {
        return setTab(next);
      }
      return undefined;
    },
    [enabledTabs, setTab],
  );

  return [activeTab, setActiveTab] as const;
}
