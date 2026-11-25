"use client";

import { parseAsStringLiteral } from "nuqs";
import { type RefObject, useEffect, useEffectEvent, useRef } from "react";

export const STUDIO_SORT_VALUES = ["newest", "best"] as const;
export type StudioSort = (typeof STUDIO_SORT_VALUES)[number];

export const studioSortParser =
  parseAsStringLiteral(STUDIO_SORT_VALUES).withDefault("newest");

/**
 * Reloads studio state when the URL-owned `sort` differs from the last
 * requested ordering for `projectId` (seeded from `loadedSortRef` on mount or
 * project switch), issuing one fetch per real transition while skipping the
 * initial matching load and StrictMode replay.
 */
export function useStudioSortRefresh(
  projectId: string | null,
  sort: StudioSort,
  loadedSortRef: RefObject<StudioSort>,
  refresh: () => void | Promise<void>,
): void {
  const runRefresh = useEffectEvent(refresh);
  const lastRequestedRef = useRef<{
    projectId: string;
    sort: StudioSort;
  } | null>(null);

  useEffect(() => {
    if (!projectId) {
      lastRequestedRef.current = null;
      return;
    }
    const previous = lastRequestedRef.current;
    const lastSort =
      previous && previous.projectId === projectId
        ? previous.sort
        : loadedSortRef.current;
    lastRequestedRef.current = { projectId, sort };
    if (sort === lastSort) return;
    void runRefresh();
  }, [loadedSortRef, projectId, sort]);
}
