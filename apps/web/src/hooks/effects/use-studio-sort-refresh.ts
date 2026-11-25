"use client";

import { parseAsStringLiteral } from "nuqs";
import { type RefObject, useEffect, useEffectEvent, useRef } from "react";

export const STUDIO_SORT_VALUES = ["newest", "best"] as const;
export type StudioSort = (typeof STUDIO_SORT_VALUES)[number];

export const studioSortParser =
  parseAsStringLiteral(STUDIO_SORT_VALUES).withDefault("newest");

/**
 * Reloads studio state when the URL-owned `sort` differs from the ordering
 * currently loaded for `projectId`, deduplicating in-flight runs (including
 * StrictMode double-effects) for the same `(projectId, sort)` pair.
 */
export function useStudioSortRefresh(
  projectId: string | null,
  sort: StudioSort,
  loadedSortRef: RefObject<StudioSort>,
  refresh: () => void | Promise<void>,
): void {
  const runRefresh = useEffectEvent(refresh);
  const requestedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      requestedKeyRef.current = null;
      return;
    }
    if (sort === loadedSortRef.current) {
      requestedKeyRef.current = null;
      return;
    }
    const requestKey = `${projectId}:${sort}`;
    if (requestedKeyRef.current === requestKey) return;
    requestedKeyRef.current = requestKey;
    void runRefresh();
  }, [loadedSortRef, projectId, sort]);
}
