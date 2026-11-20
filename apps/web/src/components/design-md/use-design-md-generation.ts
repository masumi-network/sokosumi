"use client";

import { isDesignMdJobInProgress } from "@sokosumi/masumi/tools";
import { useCallback, useRef, useState } from "react";

import { useAbortControllers } from "@/hooks/effects/use-abort-controller";
import { useScheduledTimeout } from "@/hooks/effects/use-scheduled-timeout";
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
  /** Called once a background job exists — lets callers persist it so another
   * surface (e.g. the project page) can `resume` polling after navigation. */
  onJobStarted?: (job: {
    jobId: string;
    jobToken: string;
    url: string;
  }) => void;
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
  const pollTimeout = useScheduledTimeout();
  const operations = useAbortControllers();
  const inFlightRef = useRef(false);

  const completeGeneration = useCallback(
    (designMd: PersistedDesignMd, signal: AbortSignal) => {
      onCompleted?.(designMd);
      if (!signal.aborted) {
        setState({ errorMessage: null, status: "completed" });
      }
      inFlightRef.current = false;
      onSettled?.();
    },
    [onCompleted, onSettled],
  );

  const failGeneration = useCallback(
    (message: string, signal: AbortSignal) => {
      pollTimeout.cancel();
      if (!signal.aborted) {
        setState({ errorMessage: message, status: "failed" });
      }
      inFlightRef.current = false;
      onSettled?.();
    },
    [onSettled, pollTimeout],
  );

  const pollUntilDone = useCallback(
    (jobId: string, jobToken: string) => {
      pollTimeout.schedule(async () => {
        const op = operations.create();
        setState({ errorMessage: null, status: "polling" });

        try {
          const pollResult = await pollDesignMdGeneration({
            jobId,
            jobToken,
            owner,
          });

          if (!pollResult.ok) {
            failGeneration(
              pollResult.error.message ?? messages.generationFailed,
              op.signal,
            );
            return;
          }

          if (pollResult.value.status === "failed") {
            failGeneration(
              pollResult.value.error ??
                pollResult.value.message ??
                messages.generationFailed,
              op.signal,
            );
            return;
          }

          if (isDesignMdJobInProgress(pollResult.value)) {
            if (!op.signal.aborted) {
              pollUntilDone(jobId, jobToken);
            }
            return;
          }

          if (!op.signal.aborted) {
            setState({ errorMessage: null, status: "finalizing" });
          }
          const finalizeResult = await finalizeDesignMdGeneration({
            jobId,
            jobToken,
            owner,
          });

          if (!finalizeResult.ok) {
            failGeneration(
              finalizeResult.error.message ?? messages.saveFailed,
              op.signal,
            );
            return;
          }

          completeGeneration(finalizeResult.value, op.signal);
        } catch (error) {
          failGeneration(
            getUnknownErrorMessage(error, messages.generationFailed),
            op.signal,
          );
        } finally {
          operations.release(op);
        }
      }, pollIntervalMs);
    },
    [
      completeGeneration,
      failGeneration,
      messages,
      operations,
      owner,
      pollIntervalMs,
      pollTimeout,
    ],
  );

  const generate = useCallback(
    async ({ force, url }: GenerateDesignMdInput) => {
      if (inFlightRef.current) return;

      pollTimeout.cancel();
      inFlightRef.current = true;
      setState({ errorMessage: null, status: "starting" });
      const op = operations.create();

      try {
        const startResult = await startDesignMdGeneration({
          force,
          owner,
          url,
        });

        if (!startResult.ok) {
          failGeneration(
            startResult.error.message ?? messages.startFailed,
            op.signal,
          );
          return;
        }

        if (startResult.value.kind === "completed") {
          completeGeneration(startResult.value.data, op.signal);
          return;
        }

        if (!op.signal.aborted) {
          setState({ errorMessage: null, status: "polling" });
        }
        onJobStarted?.({
          jobId: startResult.value.jobId,
          jobToken: startResult.value.jobToken,
          url,
        });
        if (!op.signal.aborted) {
          pollUntilDone(startResult.value.jobId, startResult.value.jobToken);
        }
      } catch (error) {
        failGeneration(
          getUnknownErrorMessage(error, messages.generationFailed),
          op.signal,
        );
      } finally {
        operations.release(op);
      }
    },
    [
      completeGeneration,
      failGeneration,
      messages,
      onJobStarted,
      operations,
      owner,
      pollTimeout,
      pollUntilDone,
    ],
  );

  /** Continue polling a job another surface started (see `onJobStarted`). */
  const resume = useCallback(
    (job: { jobId: string; jobToken: string }) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setState({ errorMessage: null, status: "polling" });
      pollUntilDone(job.jobId, job.jobToken);
    },
    [pollUntilDone],
  );

  const reset = useCallback(() => {
    pollTimeout.cancel();
    inFlightRef.current = false;
    setState({ errorMessage: null, status: "idle" });
  }, [pollTimeout]);

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
