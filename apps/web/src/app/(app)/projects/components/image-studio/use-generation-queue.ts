"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { startImageGeneration } from "@/lib/actions/image-studio/action";

import type { StudioSettings } from "./types";

/**
 * Bulk creation against a provider cap the browser does not get to raise.
 *
 * Core allows a fixed number of generations in flight per project and rejects
 * the rest with `image_studio_project_busy`. Asking for four images at once is
 * an ordinary thing to want, so the queue dispatches what Core will take and
 * holds the rest, sending each one as a slot frees up.
 *
 * The cap itself is deliberately not duplicated here. The UI learns it by
 * being told "busy" and waiting, which stays correct if Core ever changes the
 * number — a copied constant would not.
 *
 * The queue lives in this page only. Nothing is written to storage, and a
 * closed tab drops whatever has not been sent; the composer says so, because
 * a queue that looks durable and is not would be worse than no queue.
 */

/** The error kind Core uses for "this project already has enough in flight". */
const BUSY_KIND = "image_studio_project_busy";

/** How long to wait before offering a held request to Core again. */
const RETRY_AFTER_BUSY_MS = 4_000;

export interface QueuedGeneration {
  /** Client-side identity, stable across retries of the same request. */
  id: string;
  prompt: string;
  modelId: string;
  /** Shown while the request waits, so a batch is legible before it lands. */
  modelLabel: string;
  settings: StudioSettings;
  parentAssetId: string | null;
  referenceAssetIds: string[];
  /** Fixed per request: a retry must return the first job, never buy a second. */
  idempotencyKey: string;
}

export interface GenerationQueue {
  /** Requests not yet accepted by Core, oldest first. */
  queued: QueuedGeneration[];
  /** True while Core is holding the queue back at its concurrency cap. */
  waitingForSlot: boolean;
  /** The last request that failed for a reason retrying will not fix. */
  lastError: string | null;
  enqueue: (requests: QueuedGeneration[]) => void;
  /** Drops a request that has not been sent yet. */
  remove: (id: string) => void;
  clearError: () => void;
}

/**
 * A request whose outcome never came back.
 *
 * Treated as "will not fix itself" rather than "busy": the action already
 * reports a busy Core as data, so an exception here is a transport or session
 * failure, and looping on it would send the same request at a wall.
 */
const UNREACHABLE = "Could not reach the studio. Try again.";

export function useGenerationQueue({
  projectId,
  onAccepted,
}: {
  projectId: string;
  /** Fires after Core accepts a request, so the page can go look for it. */
  onAccepted: () => void;
}): GenerationQueue {
  const [queued, setQueued] = useState<QueuedGeneration[]>([]);
  const [waitingForSlot, setWaitingForSlot] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  /**
   * Whether a send is in flight.
   *
   * A ref, not state: the dispatch effect must not re-run when it flips, or
   * every send would schedule another pass over the same head of the queue.
   */
  const sendingRef = useRef(false);
  /** Set while a busy wait is pending, so only one timer exists at a time. */
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    },
    [],
  );

  // Draining a queue into a server the browser does not control is external
  // synchronization, which is what an Effect is for.
  useEffect(() => {
    const next = queued[0];
    if (!next || sendingRef.current || retryTimerRef.current) return;

    let cancelled = false;
    sendingRef.current = true;

    void (async () => {
      try {
        const result = await startImageGeneration({
          projectId,
          modelId: next.modelId,
          prompt: next.prompt,
          settings: next.settings,
          parentAssetId: next.parentAssetId,
          referenceAssetIds: next.referenceAssetIds,
          sessionId: null,
          idempotencyKey: next.idempotencyKey,
        });
        if (cancelled) return;

        if (result.ok) {
          setWaitingForSlot(false);
          setQueued((current) => current.filter((item) => item.id !== next.id));
          onAccepted();
          return;
        }

        if (result.kind === BUSY_KIND) {
          // Core is full, not broken. Keep the request and come back to it;
          // dropping it here is how a batch of four silently becomes three.
          setWaitingForSlot(true);
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            // A state write is what re-runs this effect; the queue itself is
            // unchanged, so it is rewritten to the same contents.
            setQueued((current) => [...current]);
          }, RETRY_AFTER_BUSY_MS);
          return;
        }

        // Anything else — an unsupported combination, an hourly spend cap, a
        // revoked membership — will fail again on every retry, so the request
        // is dropped and said out loud rather than looping against Core.
        setWaitingForSlot(false);
        setLastError(result.message);
        setQueued((current) => current.filter((item) => item.id !== next.id));
      } catch {
        if (cancelled) return;
        setWaitingForSlot(false);
        setLastError(UNREACHABLE);
        setQueued((current) => current.filter((item) => item.id !== next.id));
      } finally {
        if (!cancelled) sendingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      sendingRef.current = false;
    };
  }, [onAccepted, projectId, queued]);

  const enqueue = useCallback((requests: QueuedGeneration[]) => {
    if (requests.length === 0) return;
    setLastError(null);
    setQueued((current) => [...current, ...requests]);
  }, []);

  const remove = useCallback((id: string) => {
    setQueued((current) => current.filter((item) => item.id !== id));
  }, []);

  const clearError = useCallback(() => setLastError(null), []);

  return { queued, waitingForSlot, lastError, enqueue, remove, clearError };
}
