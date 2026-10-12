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
 *
 * Nothing survives a change of project. `projectId` identifies whose state
 * this is, so a new one is a new state rather than something to merge into the
 * old one, and any request already in the air for the project that just left
 * is dropped when it lands instead of being folded into the one that arrived.
 * The studio subtree is also remounted per project (see the `key` in the
 * studio route), which is what clears the filter, the reference selection, the
 * draft prompt and the in-page queue; this hook is correct without that, so
 * neither is load-bearing on its own.
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
  /** Null for the curated landing page, which does not load project images. */
  projectId: string | null;
  initialState: StudioState;
  initialSelectedAssetId: string | null;
  onSelectionChange?: (assetId: string | null) => void;
}): StudioStateHook {
  const { projectId, initialState, initialSelectedAssetId } = options;
  const [state, setState] = useState<StudioState>(initialState);
  const [error, setError] = useState<StudioErrorCode | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selection, setSelection] = useState<Selection>(() =>
    openingSelection(initialState, initialSelectedAssetId),
  );

  /**
   * Which project the state on screen belongs to, and the reset when it moves.
   *
   * Adjusting state during render rather than in an Effect, which is React's
   * own answer to "reset when a prop changes": an Effect would let one paint
   * through with the previous project's gallery still on it, and that paint is
   * the bug — the images of a project the reader has just navigated away from,
   * under the name of the one they navigated to, until a reload.
   *
   * `shownState` and `shownSelection` are what the rest of this render reads,
   * so the switch is complete in the same pass that noticed it and the refs
   * below cannot be written with the departing project's data.
   */
  const [shownProjectId, setShownProjectId] = useState(projectId);
  const switching = projectId !== shownProjectId;
  const shownState = switching ? initialState : state;
  const shownSelection = switching
    ? openingSelection(initialState, initialSelectedAssetId)
    : selection;
  if (switching) {
    setShownProjectId(projectId);
    setState(initialState);
    setSelection(shownSelection);
    setError(null);
    setIsRefreshing(false);
  }

  // Read inside the fetch callback without making it a dependency, so a
  // selection change never restarts the poll.
  const selectionRef = useRef(shownSelection);
  selectionRef.current = shownSelection;
  const stateRef = useRef(shownState);
  stateRef.current = shownState;
  /**
   * The project every reply is checked against.
   *
   * A refresh or a page load started for the previous project can still be in
   * flight when the switch happens. Applying it would put that project's
   * assets back on the new project's gallery — the same stale gallery this
   * hook resets to avoid, arriving a few hundred milliseconds late.
   */
  const shownProjectIdRef = useRef(projectId);
  shownProjectIdRef.current = projectId;
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
    if (!projectId) return;
    setIsRefreshing(true);
    try {
      // The selection is pinned into the request so a version older than the
      // newest page is still returned, and the preview does not empty out at
      // image 101.
      const selected = selectionRef.current.assetId;
      const query = selected ? `?assetId=${encodeURIComponent(selected)}` : "";
      const response = await fetch(`${stateUrl(projectId)}${query}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      // Abandoned: the reader has moved to another project since this went
      // out. Neither its rows nor its failure belongs to what is on screen.
      if (projectId !== shownProjectIdRef.current) return;
      if (!response.ok) {
        // A code, not a sentence: the page owns the wording so German and
        // Spanish readers do not get an English string on a translated page.
        setError(
          response.status === 401 ? "session_expired" : "refresh_failed",
        );
        return;
      }
      const next = (await response.json()) as StudioState;
      if (projectId !== shownProjectIdRef.current) return;
      setError(null);
      applyState(next);
    } catch {
      if (projectId !== shownProjectIdRef.current) return;
      setError("refresh_failed");
    } finally {
      if (projectId === shownProjectIdRef.current) setIsRefreshing(false);
    }
  }, [projectId, applyState]);

  const activeJobs = shownState.jobs.filter(isActive);
  const hasActive = activeJobs.length > 0;

  // Synchronizing with a server is exactly what an Effect is for. The interval
  // tightens while something is in flight and relaxes when nothing is.
  useEffect(() => {
    if (!projectId) return;
    const period = hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    const timer = setInterval(() => {
      void refresh();
    }, period);
    return () => clearInterval(timer);
  }, [projectId, hasActive, refresh]);

  /**
   * Fetch the next page of older versions and keep what is already shown.
   *
   * Merged by id rather than replaced, so an already-pinned selection and the
   * newest page both survive.
   */
  const loadOlder = useCallback(async () => {
    if (!projectId) return;
    // Through the ref rather than through a dependency: the ref always holds
    // the project on screen, so this cannot page the previous project's
    // history into the current project's gallery.
    const cursor = stateRef.current.nextCursor;
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
        `${stateUrl(projectId)}?${query.toString()}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok) return;
      const older = (await response.json()) as StudioState;
      // Same rule as the refresh: an older page of the project the reader has
      // left is not older history of the one they are looking at.
      if (projectId !== shownProjectIdRef.current) return;
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
      if (projectId !== shownProjectIdRef.current) return;
      setError("load_older_failed");
    } finally {
      if (projectId === shownProjectIdRef.current) setIsRefreshing(false);
    }
  }, [projectId]);

  const selectAsset = useCallback(
    (assetId: string) => {
      setSelection({ assetId, chosenByUserAt: Date.now() });
      onSelectionChange?.(assetId);
    },
    [onSelectionChange],
  );

  const selectedAsset =
    shownState.assets.find((asset) => asset.id === shownSelection.assetId) ??
    null;

  return {
    state: shownState,
    selectedAsset,
    selectAsset,
    activeJobs,
    refresh,
    loadOlder,
    hasOlder: shownState.nextCursor !== null,
    isRefreshing: switching ? false : isRefreshing,
    error: switching ? null : error,
  };
}

function stateUrl(projectId: string): string {
  return `/api/projects/${projectId}/image-studio/state`;
}

/**
 * Which version a freshly opened project shows.
 *
 * The URL's `?v=` wins, because it is the reader naming one; otherwise the
 * newest, and `chosenByUserAt` stays null so the first result that arrives may
 * still take the preview.
 */
function openingSelection(
  state: StudioState,
  selectedAssetId: string | null,
): Selection {
  return {
    assetId: selectedAssetId ?? state.assets[0]?.id ?? null,
    chosenByUserAt: selectedAssetId ? Date.now() : null,
  };
}
