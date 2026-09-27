"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { StudioAsset, StudioJob, StudioState } from "./types";
import { isActive } from "./types";

/**
 * The studio's live state, and the rule about what a completed generation may
 * take over.
 *
 * Two things must survive an update that arrives while someone is working:
 * the version they are looking at, and the text they are typing. Neither is
 * derived from the server payload, so neither is replaced by one.
 *
 * Auto-selection is the subtle part. Showing a finished image immediately is
 * right when the person is waiting for it, and wrong when they have since
 * clicked onto something else — that is them saying "not this one". So a
 * result is selected only when the selection has not been touched by hand
 * since that job was started.
 */

const IDLE_POLL_MS = 15_000;
const ACTIVE_POLL_MS = 3_000;

interface Selection {
  assetId: string | null;
  /** When the person last chose a version themselves. */
  chosenByUserAt: number | null;
}

export interface StudioStateHook {
  state: StudioState;
  selectedAsset: StudioAsset | null;
  selectAsset: (assetId: string) => void;
  activeJobs: StudioJob[];
  refresh: () => Promise<void>;
  /** Appends the next, older page of versions. */
  loadOlder: () => Promise<void>;
  hasOlder: boolean;
  isRefreshing: boolean;
  /** A code the page maps to a localized message, never a display string. */
  error: StudioErrorCode | null;
}

export type StudioErrorCode =
  | "session_expired"
  | "refresh_failed"
  | "load_older_failed";

export function useStudioState(options: {
  projectId: string;
  initialState: StudioState;
  initialSelectedAssetId: string | null;
  onSelectionChange?: (assetId: string | null) => void;
}): StudioStateHook {
  const { projectId, initialState, initialSelectedAssetId } = options;
  const [state, setState] = useState<StudioState>(initialState);
  const [error, setError] = useState<StudioErrorCode | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selection, setSelection] = useState<Selection>({
    assetId: initialSelectedAssetId ?? initialState.assets[0]?.id ?? null,
    chosenByUserAt: initialSelectedAssetId ? Date.now() : null,
  });

  // Read inside the fetch callback without making it a dependency, so a
  // selection change never restarts the poll.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const stateRef = useRef(state);
  stateRef.current = state;
  const onSelectionChange = options.onSelectionChange;

  /**
   * Fold a fresh payload into what is on screen.
   *
   * The auto-selection decision is made here rather than inside a `setState`
   * updater: an updater must be pure, and React may run it twice or during a
   * later render. Calling `router.replace` from inside one produced a
   * "cannot update a component while rendering" warning and could replace the
   * URL twice.
   */
  const applyState = useCallback(
    (next: StudioState) => {
      const previous = stateRef.current;
      const current = selectionRef.current;

      const known = new Set(previous.assets.map((asset) => asset.id));
      const arrived = next.assets.filter((asset) => !known.has(asset.id));
      // Older pages already loaded are not in `next`. Keeping them means
      // "load older" is not undone by the next poll.
      const returned = new Set(next.assets.map((asset) => asset.id));
      const keptOlder = previous.assets.filter(
        (asset) => !returned.has(asset.id),
      );

      let selected: string | null = null;
      if (arrived.length > 0) {
        // Newest first, so the first arrival is the one to consider.
        const candidate = arrived[0]!;
        const startedAt = next.jobs.find(
          (job) => job.assetId === candidate.id,
        )?.createdAt;
        const jobStartedAt = startedAt
          ? new Date(startedAt as unknown as string).getTime()
          : null;

        const selectionIsUntouched =
          current.chosenByUserAt === null ||
          (jobStartedAt !== null && current.chosenByUserAt < jobStartedAt);

        // Nothing selected yet is the first-use case: show the first image.
        if (current.assetId === null || selectionIsUntouched) {
          selected = candidate.id;
        }
      }

      // A refresh returns the newest page, whose cursor points just past it.
      // Overwriting the cursor with that value threw away how far the person
      // had already paged, so "load older" started again from the top.
      const merged = {
        ...next,
        assets: [...next.assets, ...keptOlder],
        nextCursor:
          keptOlder.length > 0 ? previous.nextCursor : next.nextCursor,
      };
      stateRef.current = merged;
      setState(merged);

      if (selected) {
        setSelection({ assetId: selected, chosenByUserAt: null });
        onSelectionChange?.(selected);
      }
    },
    [onSelectionChange],
  );

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // The selection is pinned into the request so a version older than the
      // newest page is still returned, and the preview does not empty out at
      // image 101.
      const selected = selectionRef.current.assetId;
      const query = selected ? `?assetId=${encodeURIComponent(selected)}` : "";
      const response = await fetch(
        `/api/projects/${projectId}/image-studio/state${query}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok) {
        // A code, not a sentence: the page owns the wording so German and
        // Spanish readers do not get an English string on a translated page.
        setError(
          response.status === 401 ? "session_expired" : "refresh_failed",
        );
        return;
      }
      setError(null);
      applyState((await response.json()) as StudioState);
    } catch {
      setError("refresh_failed");
    } finally {
      setIsRefreshing(false);
    }
  }, [projectId, applyState]);

  const activeJobs = state.jobs.filter(isActive);
  const hasActive = activeJobs.length > 0;

  // Synchronizing with a server is exactly what an Effect is for. The interval
  // tightens while something is in flight and relaxes when nothing is.
  useEffect(() => {
    const period = hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    const timer = setInterval(() => {
      void refresh();
    }, period);
    return () => clearInterval(timer);
  }, [hasActive, refresh]);

  /**
   * Fetch the next page of older versions and keep what is already shown.
   *
   * Merged by id rather than replaced, so an already-pinned selection and the
   * newest page both survive.
   */
  const loadOlder = useCallback(async () => {
    const cursor = state.nextCursor;
    if (!cursor) return;
    setIsRefreshing(true);
    try {
      // Both halves of the cursor: versions settled in the same millisecond
      // are ordinary here, and a timestamp alone steps over every tie.
      const query = new URLSearchParams({
        before: new Date(cursor.createdAt as unknown as string).toISOString(),
        beforeId: cursor.id,
      });
      const response = await fetch(
        `/api/projects/${projectId}/image-studio/state?${query.toString()}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok) return;
      const older = (await response.json()) as StudioState;
      const previous = stateRef.current;
      const known = new Set(previous.assets.map((asset) => asset.id));
      const merged = {
        ...previous,
        assets: [
          ...previous.assets,
          ...older.assets.filter((asset) => !known.has(asset.id)),
        ],
        nextCursor: older.nextCursor,
      };
      stateRef.current = merged;
      setState(merged);
    } catch {
      setError("load_older_failed");
    } finally {
      setIsRefreshing(false);
    }
  }, [projectId, state.nextCursor]);

  const selectAsset = useCallback(
    (assetId: string) => {
      setSelection({ assetId, chosenByUserAt: Date.now() });
      onSelectionChange?.(assetId);
    },
    [onSelectionChange],
  );

  const selectedAsset =
    state.assets.find((asset) => asset.id === selection.assetId) ?? null;

  return {
    state,
    selectedAsset,
    selectAsset,
    activeJobs,
    refresh,
    loadOlder,
    hasOlder: state.nextCursor !== null,
    isRefreshing,
    error,
  };
}
