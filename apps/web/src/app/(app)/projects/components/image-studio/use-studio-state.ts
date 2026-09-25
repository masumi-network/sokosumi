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
  isRefreshing: boolean;
  error: string | null;
}

export function useStudioState(options: {
  projectId: string;
  initialState: StudioState;
  initialSelectedAssetId: string | null;
  onSelectionChange?: (assetId: string | null) => void;
}): StudioStateHook {
  const { projectId, initialState, initialSelectedAssetId } = options;
  const [state, setState] = useState<StudioState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selection, setSelection] = useState<Selection>({
    assetId: initialSelectedAssetId ?? initialState.assets[0]?.id ?? null,
    chosenByUserAt: initialSelectedAssetId ? Date.now() : null,
  });

  // Read inside the fetch callback without making it a dependency, so a
  // selection change never restarts the poll.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const onSelectionChange = options.onSelectionChange;

  const applyState = useCallback(
    (next: StudioState) => {
      setState((previous) => {
        const current = selectionRef.current;
        const known = new Set(previous.assets.map((asset) => asset.id));
        const arrived = next.assets.filter((asset) => !known.has(asset.id));

        if (arrived.length > 0) {
          // Newest first, so the first arrival is the one to consider.
          const candidate = arrived[0]!;
          const startedAt = next.jobs.find(
            (job) => job.assetId === candidate.id,
          )?.createdAt;
          // The generated client transforms date fields into `Date`, but a
          // payload straight off `fetch()` in this hook has not been through
          // that transformer, so accept either.
          const jobStartedAt = startedAt
            ? new Date(startedAt as unknown as string).getTime()
            : null;

          const selectionIsUntouched =
            current.chosenByUserAt === null ||
            (jobStartedAt !== null && current.chosenByUserAt < jobStartedAt);

          // Nothing selected yet is the first-use case: show the first image.
          if (current.assetId === null || selectionIsUntouched) {
            setSelection({ assetId: candidate.id, chosenByUserAt: null });
            onSelectionChange?.(candidate.id);
          }
        }
        return next;
      });
    },
    [onSelectionChange],
  );

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/image-studio/state`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok) {
        setError(
          response.status === 401
            ? "Your session expired. Reload to continue."
            : "Could not refresh. Retrying.",
        );
        return;
      }
      setError(null);
      applyState((await response.json()) as StudioState);
    } catch {
      setError("Could not refresh. Retrying.");
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
    isRefreshing,
    error,
  };
}
