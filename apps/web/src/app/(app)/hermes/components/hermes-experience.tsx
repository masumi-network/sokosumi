"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import EmptyState from "@/app/hermes/components/empty-state";
import ErrorState from "@/app/hermes/components/error-state";
import ProvisioningState from "@/app/hermes/components/provisioning-state";
import RunningState from "@/app/hermes/components/running-state";
import {
  destroyHermesAction,
  getHermesInstanceAction,
  listHermesMessagesAction,
  provisionHermesAction,
} from "@/lib/actions/hermes";
import type {
  HermesInstancePublic,
  HermesInstanceStatus,
  HermesPersistedMessage,
} from "@/lib/hermes/types";

type UiState = "loading" | "idle" | "provisioning" | "running" | "error";

interface HermesExperienceProps {
  userName?: string | null;
  userImageUrl?: string | null;
}

const POLL_INTERVAL_MS = 5_000;
const PROVISION_DEADLINE_MS = 15 * 60_000;

function uiStateForServerStatus(status: HermesInstanceStatus): UiState {
  if (status === "running" || status === "suspended") return "running";
  if (status === "provisioning") return "provisioning";
  return "error";
}

export default function HermesExperience({
  userName,
  userImageUrl,
}: HermesExperienceProps) {
  const params = useSearchParams();
  const previewParam = params?.get("state");
  const previewMode =
    previewParam === "idle" ||
    previewParam === "provisioning" ||
    previewParam === "running" ||
    previewParam === "error";

  const [uiState, setUiState] = useState<UiState>(
    previewMode ? (previewParam as UiState) : "loading",
  );
  const [instance, setInstance] = useState<HermesInstancePublic | null>(null);
  const [initialMessages, setInitialMessages] = useState<
    HermesPersistedMessage[]
  >([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /** Loads instance state and persisted history in parallel (no provision). */
  const refetchHermes = useCallback(
    async (options?: { isCancelled?: () => boolean }) => {
      const isCancelled = options?.isCancelled;
      const [instanceResult, messagesResult] = await Promise.all([
        getHermesInstanceAction({}),
        listHermesMessagesAction({}),
      ]);
      if (isCancelled?.()) return;
      if (!instanceResult.ok) {
        setUiState("error");
        setErrorMessage(
          instanceResult.error.message ?? "Failed to reach Hermes.",
        );
        return;
      }
      if (messagesResult.ok) {
        setInitialMessages(messagesResult.data);
      }
      if (!instanceResult.data) {
        setUiState("idle");
        setInstance(null);
        return;
      }
      setInstance(instanceResult.data);
      setUiState(uiStateForServerStatus(instanceResult.data.status));
    },
    [],
  );

  // Initial fetch (skipped in preview mode).
  useEffect(() => {
    if (previewMode) return;
    let cancelled = false;
    void refetchHermes({ isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [previewMode, refetchHermes]);

  // Polling loop bound to the `provisioning` UI state. Starts on entry,
  // teardown cancels in-flight requests and clears the timer.
  useEffect(() => {
    if (previewMode) return;
    if (uiState !== "provisioning") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = Date.now() + PROVISION_DEADLINE_MS;

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() > deadline) {
        setUiState("error");
        setErrorMessage(
          "Provisioning timed out after 15 minutes. Please try again.",
        );
        return;
      }
      const result = await getHermesInstanceAction({});
      if (cancelled) return;
      if (!result.ok) {
        setUiState("error");
        setErrorMessage(result.error.message ?? "Failed to reach Hermes.");
        return;
      }
      if (result.data) {
        const next = uiStateForServerStatus(result.data.status);
        if (next !== "provisioning") {
          if (next === "running") {
            const messagesResult = await listHermesMessagesAction({});
            if (cancelled) return;
            if (messagesResult.ok) setInitialMessages(messagesResult.data);
          }
          if (cancelled) return;
          setInstance(result.data);
          setUiState(next);
          return;
        }
        setInstance(result.data);
      } else {
        // Provision call succeeded but the instance disappeared — treat as error.
        setUiState("error");
        setErrorMessage("Hermes instance vanished mid-provision.");
        return;
      }
      timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };

    timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [uiState, previewMode]);

  const handleActivate = useCallback(async () => {
    setUiState("provisioning");
    setErrorMessage(null);
    const result = await provisionHermesAction({});
    if (!result.ok) {
      setUiState("error");
      setErrorMessage(
        result.error.message ?? "Failed to provision your Hermes.",
      );
      return;
    }
    setInstance(result.data);
    const nextUi = uiStateForServerStatus(result.data.status);
    if (nextUi === "running") {
      const messagesResult = await listHermesMessagesAction({});
      if (messagesResult.ok) setInitialMessages(messagesResult.data);
    }
    // Immediately reflect server-side status — if it already came back as
    // "running" the polling effect will just no-op.
    setUiState(nextUi);
  }, []);

  const handleRetry = useCallback(() => {
    if (previewMode) return;
    setErrorMessage(null);
    setUiState("loading");
    void refetchHermes();
  }, [previewMode, refetchHermes]);

  const handleDestroy = useCallback(async () => {
    if (previewMode) {
      setInstance(null);
      setUiState("idle");
      return;
    }
    const result = await destroyHermesAction({});
    if (!result.ok) {
      toast.error(result.error.message ?? "Failed to destroy your Hermes.");
      return;
    }
    setInstance(null);
    setInitialMessages([]);
    setUiState("idle");
  }, [previewMode]);

  if (uiState === "loading") {
    // Stay blank while we fetch — avoids a flash of the wrong state.
    return null;
  }

  if (uiState === "idle") {
    return <EmptyState onActivate={handleActivate} />;
  }
  if (uiState === "provisioning") {
    return <ProvisioningState />;
  }
  if (uiState === "error") {
    return (
      <ErrorState message={errorMessage ?? undefined} onRetry={handleRetry} />
    );
  }
  return (
    <RunningState
      userName={userName ?? null}
      userImageUrl={userImageUrl ?? null}
      instance={instance}
      previewMode={previewMode}
      initialMessages={initialMessages}
      onDestroy={handleDestroy}
    />
  );
}
