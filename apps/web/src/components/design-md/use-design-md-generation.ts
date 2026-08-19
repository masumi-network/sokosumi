"use client";

import { isDesignMdJobInProgress } from "@sokosumi/masumi/tools";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  finalizeDesignMdGeneration,
  pollDesignMdGeneration,
  startDesignMdGeneration,
} from "@/lib/actions/design-md";
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
  /** Called once a background job exists — lets callers persist it so another
   * surface (e.g. the project page) can `resume` polling after navigation. */
  onJobStarted?: (job: { jobId: string; jobToken: string }) => void;
  onSettled?: () => void;
  owner: DesignMdOwner;
  pollIntervalMs?: number;
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
  onJobStarted,
  onSettled,
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

  const clearPollTimeout = useCallback(() => {
    if (!timeoutRef.current) return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const safeSetState = useCallback((nextState: DesignMdGenerationState) => {
    if (mountedRef.current) setState(nextState);
  }, []);

  const completeGeneration = useCallback(
    (designMd: PersistedDesignMd) => {
      onCompleted?.(designMd);
      safeSetState({ errorMessage: null, status: "completed" });
      inFlightRef.current = false;
      onSettled?.();
    },
    [onCompleted, onSettled, safeSetState],
  );

  const failGeneration = useCallback(
    (message: string) => {
      clearPollTimeout();
      safeSetState({ errorMessage: message, status: "failed" });
      inFlightRef.current = false;
      onSettled?.();
    },
    [clearPollTimeout, onSettled, safeSetState],
  );

  const pollUntilDone = useCallback(
    (jobId: string, jobToken: string) => {
      clearPollTimeout();
      timeoutRef.current = setTimeout(async () => {
        safeSetState({ errorMessage: null, status: "polling" });

        try {
          const pollResult = await pollDesignMdGeneration({
            jobId,
            jobToken,
            owner,
          });

          if (!pollResult.ok) {
            failGeneration(
              pollResult.error.message ?? messages.generationFailed,
            );
            return;
          }

          if (pollResult.value.status === "failed") {
            failGeneration(
              pollResult.value.error ??
                pollResult.value.message ??
                messages.generationFailed,
            );
            return;
          }

          if (isDesignMdJobInProgress(pollResult.value)) {
            pollUntilDone(jobId, jobToken);
            return;
          }

          safeSetState({ errorMessage: null, status: "finalizing" });
          const finalizeResult = await finalizeDesignMdGeneration({
            jobId,
            jobToken,
            owner,
          });

          if (!finalizeResult.ok) {
            failGeneration(finalizeResult.error.message ?? messages.saveFailed);
            return;
          }

          completeGeneration(finalizeResult.value);
        } catch (error) {
          failGeneration(
            getUnknownErrorMessage(error, messages.generationFailed),
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
      pollIntervalMs,
      safeSetState,
    ],
  );

  const generate = useCallback(
    async ({ force, url }: GenerateDesignMdInput) => {
      if (inFlightRef.current) return;

      clearPollTimeout();
      inFlightRef.current = true;
      safeSetState({ errorMessage: null, status: "starting" });

      try {
        const startResult = await startDesignMdGeneration({
          force,
          owner,
          url,
        });

        if (!startResult.ok) {
          failGeneration(startResult.error.message ?? messages.startFailed);
          return;
        }

        if (startResult.value.kind === "completed") {
          completeGeneration(startResult.value.data);
          return;
        }

        safeSetState({ errorMessage: null, status: "polling" });
        onJobStarted?.({
          jobId: startResult.value.jobId,
          jobToken: startResult.value.jobToken,
        });
        pollUntilDone(startResult.value.jobId, startResult.value.jobToken);
      } catch (error) {
        failGeneration(
          getUnknownErrorMessage(error, messages.generationFailed),
        );
      }
    },
    [
      clearPollTimeout,
      completeGeneration,
      failGeneration,
      messages,
      onJobStarted,
      owner,
      pollUntilDone,
      safeSetState,
    ],
  );

  /** Continue polling a job another surface started (see `onJobStarted`). */
  const resume = useCallback(
    (job: { jobId: string; jobToken: string }) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      safeSetState({ errorMessage: null, status: "polling" });
      pollUntilDone(job.jobId, job.jobToken);
    },
    [pollUntilDone, safeSetState],
  );

  const reset = useCallback(() => {
    clearPollTimeout();
    inFlightRef.current = false;
    safeSetState({ errorMessage: null, status: "idle" });
  }, [clearPollTimeout, safeSetState]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      clearPollTimeout();
    };
  }, [clearPollTimeout]);

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
