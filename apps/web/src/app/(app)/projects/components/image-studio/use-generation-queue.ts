"use client";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
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
  /**
   * Where it runs. Per request, not per queue: the workspace view sends each
   * generation to the project it was aimed at.
   */
  projectId: string;
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

/** A request as the composer builds it, before it is aimed at a project. */
export type GenerationRequest = Omit<QueuedGeneration, "projectId">;

/** Localized failure codes; other rejections retain Core's message. */
export type QueueErrorCode = "unreachable" | "insufficient_credits";

export interface FailedGeneration {
  request: QueuedGeneration;
  message: string | null;
  code: QueueErrorCode | null;
}

export interface GenerationQueue {
  failed: FailedGeneration[];
  retry: (id: string) => void;
  dismissFailed: (id: string) => void;
  /** Requests not yet accepted by Core, oldest first. */
  queued: QueuedGeneration[];
  /** True while Core is holding the queue back at its concurrency cap. */
  waitingForSlot: boolean;
  enqueue: (requests: QueuedGeneration[]) => void;
  /** Drops a request that has not been sent yet. */
  remove: (id: string) => void;
}

/**
 * A request whose outcome never came back.
 *
 * Treated as "will not fix itself" rather than "busy": the action already
 * reports a busy Core as data, so an exception here is a transport or session
 * failure, and looping on it would send the same request at a wall.
 */
const UNREACHABLE: QueueErrorCode = "unreachable";

export function useGenerationQueue({
  onAccepted,
}: {
  /**
   * Fires after Core accepts a request, so the page can go look for it.
   * `remaining` counts the requests still waiting to be sent.
   */
  onAccepted: (accepted: { remaining: number }) => void;
}): GenerationQueue {
  const [queued, setQueued] = useState<QueuedGeneration[]>([]);
  const [waitingForSlot, setWaitingForSlot] = useState(false);
  const [failed, setFailed] = useState<FailedGeneration[]>([]);
  const failedRef = useRef(failed);
  failedRef.current = failed;
  /**
   * Bumped to ask the dispatcher to look again after a busy wait.
   *
   * The dispatcher keys on the *head request's id*, not on the queue array,
   * so a retry of the same head needs its own signal. Rewriting `queued` to
   * an equal-but-new array — what this used to do — no longer re-triggers it,
   * which is the point: array identity changes for reasons that have nothing
   * to do with whether a send should start.
   */
  const [retryTick, setRetryTick] = useState(0);
  /**
   * Whether a send is in flight.
   *
   * A ref, not state: the dispatch effect must not re-run when it flips, or
   * every send would schedule another pass over the same head of the queue.
   */
  const sendingRef = useRef(false);
  const uncertainIdsRef = useRef(new Set<string>());
  /** Set while a busy wait is pending, so only one timer exists at a time. */
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Read inside the send without making the dispatcher depend on it. */
  const queuedRef = useRef<QueuedGeneration[]>(queued);
  queuedRef.current = queued;
  const updateQueued = useCallback(
    (update: (current: QueuedGeneration[]) => QueuedGeneration[]) => {
      queuedRef.current = update(queuedRef.current);
      setQueued(queuedRef.current);
    },
    [],
  );
  /**
   * The callback, held in a ref on purpose.
   *
   * `onAccepted` is the page's `refresh`, whose identity changes whenever the
   * URL's search params change — which is every arrow key and every image
   * opened. As an effect dependency it tore down an in-flight send mid-flight.
   */
  const onAcceptedRef = useRef(onAccepted);
  onAcceptedRef.current = onAccepted;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  /**
   * Draining the queue, one request at a time.
   *
   * Two rules make this safe, and both were learned the hard way. The effect
   * depends only on *which request is at the head* — not on the queue array
   * and not on the callback — because both of those change identity for
   * unrelated reasons. And it never abandons a send: there is no cleanup that
   * cancels, so an in-flight request always applies its own result.
   *
   * Before, the cleanup set `cancelled` and cleared the in-flight guard, so
   * enqueuing another image or simply pressing an arrow key tore down a live
   * send and immediately started the same one again. Core's idempotency key
   * kept that from buying a second image, but the first result was thrown
   * away, and a queue could churn instead of draining.
   */
  const headId = queued[0]?.id ?? null;
  useEffect(() => {
    if (!headId || sendingRef.current || retryTimerRef.current) return;
    const next = queuedRef.current[0];
    if (!next || next.id !== headId) return;

    sendingRef.current = true;

    void (async () => {
      try {
        const result = await startImageGeneration({
          projectId: next.projectId,
          modelId: next.modelId,
          prompt: next.prompt,
          settings: next.settings,
          parentAssetId: next.parentAssetId,
          referenceAssetIds: next.referenceAssetIds,
          sessionId: null,
          idempotencyKey: next.idempotencyKey,
        });
        // Only a real unmount stops the writes. Anything short of that and
        // the send applies its own result, which is what keeps the queue
        // draining rather than churning.
        if (!mountedRef.current) return;

        if (result.ok) {
          setWaitingForSlot(false);
          uncertainIdsRef.current.delete(next.id);
          updateQueued((current) =>
            current.filter((item) => item.id !== next.id),
          );
          onAcceptedRef.current({ remaining: queuedRef.current.length });
          return;
        }

        if (result.kind === CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE) {
          // Hold the unsent remainder for a manual retry after a top-up.
          // Earlier accepted legs must never be bought again.
          setWaitingForSlot(false);
          const remaining = queuedRef.current;
          setFailed((current) => [
            ...current,
            ...remaining.map((request) => ({
              request,
              message: null,
              code: uncertainIdsRef.current.has(request.id)
                ? UNREACHABLE
                : ("insufficient_credits" as const),
            })),
          ]);
          updateQueued(() => []);
          return;
        }

        if (result.kind === BUSY_KIND) {
          // Core is full, not broken. Keep the request and come back to it;
          // dropping it here is how a batch of four silently becomes three.
          setWaitingForSlot(true);
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            if (mountedRef.current) setRetryTick((tick) => tick + 1);
          }, RETRY_AFTER_BUSY_MS);
          return;
        }

        // Keep the exact purchase intent for a manual retry. An uncertain
        // outcome must reuse its key even when Core's response was lost.
        setWaitingForSlot(false);
        if (result.uncertain) uncertainIdsRef.current.add(next.id);
        const uncertain = uncertainIdsRef.current.has(next.id);
        setFailed((current) => [
          ...current,
          {
            request: next,
            message: uncertain ? null : result.message,
            code: uncertain ? UNREACHABLE : null,
          },
        ]);
        updateQueued((current) =>
          current.filter((item) => item.id !== next.id),
        );
      } catch {
        if (!mountedRef.current) return;
        setWaitingForSlot(false);
        uncertainIdsRef.current.add(next.id);
        setFailed((current) => [
          ...current,
          { request: next, message: null, code: UNREACHABLE },
        ]);
        updateQueued((current) =>
          current.filter((item) => item.id !== next.id),
        );
      } finally {
        sendingRef.current = false;
      }
    })();
  }, [headId, retryTick, updateQueued]);

  const enqueue = useCallback(
    (requests: QueuedGeneration[]) => {
      if (requests.length === 0) return;
      updateQueued((current) => [...current, ...requests]);
    },
    [updateQueued],
  );

  const remove = useCallback(
    (id: string) => {
      updateQueued((current) => current.filter((item) => item.id !== id));
    },
    [updateQueued],
  );

  const dismissFailed = useCallback((id: string) => {
    failedRef.current = failedRef.current.filter(
      (item) => item.request.id !== id,
    );
    setFailed((current) => current.filter((item) => item.request.id !== id));
  }, []);

  const retry = useCallback(
    (id: string) => {
      const item = failedRef.current.find((item) => item.request.id === id);
      if (!item) return;
      // Consume synchronously so a double click cannot enqueue two retries.
      dismissFailed(id);
      enqueue([item.request]);
    },
    [dismissFailed, enqueue],
  );

  return {
    failed,
    retry,
    dismissFailed,
    queued,
    waitingForSlot,
    enqueue,
    remove,
  };
}
