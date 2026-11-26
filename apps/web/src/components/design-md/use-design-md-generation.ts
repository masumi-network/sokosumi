"use client";

import { isDesignMdJobInProgress } from "@sokosumi/masumi/tools";
import { useCallback, useRef, useState } from "react";

import { useDesignMdGenerationLifecycle } from "@/hooks/effects/use-design-md-generation-lifecycle";

import {
  finalizeDesignMdGeneration,
  pollDesignMdGeneration,
  startDesignMdGeneration,
} from "@/lib/actions/design-md/action";
import type { PersistedDesignMd } from "@/lib/services/design-md.service";

import type { DesignMdOwner } from "./types";

const DEFAULT_POLL_INTERVAL_MS = 3000;

type DesignMdGenerationStatus =
  | "completed"
  | "failed"
  | "finalizing"
  | "idle"
  | "polling"
  | "starting";

interface GenerateDesignMdInput {
  force?: boolean;
  url: string;
}

interface UseDesignMdGenerationOptions {
  messages: {
    generationFailed: string;
    saveFailed: string;
    startFailed: string;
  };
  onCompleted?: (designMd: PersistedDesignMd) => void;
  /** Called when an attempt fails, with the website it tried. */
  onFailed?: (attempt: DesignMdAttempt) => void;
  /** Called once a background job exists — lets callers persist it so another
   * surface (e.g. the project page) can `resume` polling after navigation.
   * Also called after unmount, when the start answers late: nobody else
   * knows the job yet. */
  onJobStarted?: (
    job: DesignMdAttempt & {
      jobId: string;
      jobToken: string;
    },
  ) => void;
  onSettled?: (attempt: Pick<DesignMdAttempt, "attemptId">) => void;
  /** Called when `generate` or `resume` starts an attempt. */
  onStarted?: (attempt: DesignMdAttempt) => void;
  owner: DesignMdOwner;
  pollIntervalMs?: number;
}

/** One generate or resume. `attemptId` is unique across mounts, so storage
 * shared by several surfaces can tell whose attempt is the latest. */
interface DesignMdAttempt {
  attemptId: string;
  url: string;
}

interface DesignMdGenerationState {
  errorMessage: null | string;
  status: DesignMdGenerationStatus;
}

function getUnknownErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useDesignMdGeneration({
  messages,
  onCompleted,
  onFailed,
  onJobStarted,
  onSettled,
  onStarted,
  owner,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseDesignMdGenerationOptions) {
  const [{ errorMessage, status }, setState] =
    useState<DesignMdGenerationState>({
      errorMessage: null,
      status: "idle",
    });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  // Each generate, resume or reset is a new attempt. A late response from an
  // older attempt here must not call back. After unmount (a provider remount
  // or the wizard closing) the attempt still reports, so a job only it knows
  // is handed over; callers fence shared state by `attemptId`.
  const attemptRef = useRef("");
  // The website of the attempt in flight, for `onFailed`.
  const urlRef = useRef("");

  const owns = useCallback(
    (attempt: string) => attemptRef.current === attempt,
    [],
  );

  const clearPollTimeout = useCallback(() => {
    if (!timeoutRef.current) return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const safeSetState = useCallback((nextState: DesignMdGenerationState) => {
    if (mountedRef.current) setState(nextState);
  }, []);

  const completeGeneration = useCallback(
    (designMd: PersistedDesignMd, attempt: string) => {
      if (!owns(attempt)) return;
      onCompleted?.(designMd);
      safeSetState({ errorMessage: null, status: "completed" });
      inFlightRef.current = false;
      onSettled?.({ attemptId: attempt });
    },
    [onCompleted, onSettled, owns, safeSetState],
  );

  const failGeneration = useCallback(
    (message: string, attempt: string) => {
      if (!owns(attempt)) return;
      clearPollTimeout();
      safeSetState({ errorMessage: message, status: "failed" });
      inFlightRef.current = false;
      onFailed?.({ attemptId: attempt, url: urlRef.current });
      onSettled?.({ attemptId: attempt });
    },
    [clearPollTimeout, onFailed, onSettled, owns, safeSetState],
  );

  const pollUntilDone = useCallback(
    (jobId: string, jobToken: string, attempt: string) => {
      // Unmounted: the surface that resumes the pending job polls it.
      if (!mountedRef.current) return;
      clearPollTimeout();
      timeoutRef.current = setTimeout(async () => {
        if (!owns(attempt)) return;
        safeSetState({ errorMessage: null, status: "polling" });

        try {
          const pollResult = await pollDesignMdGeneration({
            jobId,
            jobToken,
            owner,
          });
          // Left while polling: the surface that resumes the pending job
          // finishes it. Finalizing here could save this job's DESIGN.md
          // over a newer one.
          if (!mountedRef.current) return;

          if (!pollResult.ok) {
            failGeneration(
              pollResult.error.message ?? messages.generationFailed,
              attempt,
            );
            return;
          }

          if (pollResult.value.status === "failed") {
            failGeneration(
              pollResult.value.error ??
                pollResult.value.message ??
                messages.generationFailed,
              attempt,
            );
            return;
          }

          if (!owns(attempt)) return;
          if (isDesignMdJobInProgress(pollResult.value)) {
            pollUntilDone(jobId, jobToken, attempt);
            return;
          }

          safeSetState({ errorMessage: null, status: "finalizing" });
          const finalizeResult = await finalizeDesignMdGeneration({
            jobId,
            jobToken,
            owner,
          });

          if (!finalizeResult.ok) {
            failGeneration(
              finalizeResult.error.message ?? messages.saveFailed,
              attempt,
            );
            return;
          }

          completeGeneration(finalizeResult.value, attempt);
        } catch (error) {
          if (!mountedRef.current) return;
          failGeneration(
            getUnknownErrorMessage(error, messages.generationFailed),
            attempt,
          );
        }
      }, pollIntervalMs);
    },
    [
      clearPollTimeout,
      completeGeneration,
      failGeneration,
      messages,
      owner,
      owns,
      pollIntervalMs,
      safeSetState,
    ],
  );

  const generate = useCallback(
    async ({ force, url }: GenerateDesignMdInput) => {
      if (inFlightRef.current) return;

      clearPollTimeout();
      inFlightRef.current = true;
      const attempt = crypto.randomUUID();
      attemptRef.current = attempt;
      urlRef.current = url;
      onStarted?.({ attemptId: attempt, url });
      safeSetState({ errorMessage: null, status: "starting" });

      try {
        const startResult = await startDesignMdGeneration({
          force,
          owner,
          url,
        });

        if (!startResult.ok) {
          failGeneration(
            startResult.error.message ?? messages.startFailed,
            attempt,
          );
          return;
        }

        if (startResult.value.kind === "completed") {
          completeGeneration(startResult.value.data, attempt);
          return;
        }

        if (!owns(attempt)) return;
        safeSetState({ errorMessage: null, status: "polling" });
        onJobStarted?.({
          attemptId: attempt,
          jobId: startResult.value.jobId,
          jobToken: startResult.value.jobToken,
          url,
        });
        pollUntilDone(
          startResult.value.jobId,
          startResult.value.jobToken,
          attempt,
        );
      } catch (error) {
        failGeneration(
          getUnknownErrorMessage(error, messages.generationFailed),
          attempt,
        );
      }
    },
    [
      clearPollTimeout,
      completeGeneration,
      failGeneration,
      messages,
      onJobStarted,
      onStarted,
      owner,
      owns,
      pollUntilDone,
      safeSetState,
    ],
  );

  /** Continue polling a job another surface started (see `onJobStarted`). */
  const resume = useCallback(
    (job: { jobId: string; jobToken: string; url: string }) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const attempt = crypto.randomUUID();
      attemptRef.current = attempt;
      urlRef.current = job.url;
      onStarted?.({ attemptId: attempt, url: job.url });
      safeSetState({ errorMessage: null, status: "polling" });
      pollUntilDone(job.jobId, job.jobToken, attempt);
    },
    [onStarted, pollUntilDone, safeSetState],
  );

  const reset = useCallback(() => {
    clearPollTimeout();
    inFlightRef.current = false;
    attemptRef.current = "";
    safeSetState({ errorMessage: null, status: "idle" });
  }, [clearPollTimeout, safeSetState]);

  useDesignMdGenerationLifecycle(mountedRef, clearPollTimeout);

  return {
    errorMessage,
    generate,
    isRunning:
      status === "starting" || status === "polling" || status === "finalizing",
    reset,
    resume,
    status,
  };
}
