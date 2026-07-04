"use client";

import { useEffect, useRef, useState } from "react";
import type { ConversationWarmupData } from "@/lib/actions/conversation/core-api-actions";
import { getConversationWarmup } from "@/lib/actions/conversation/core-api-actions";

const DEFAULT_POLL_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 2000;
const INITIAL_BACKOFF_MS = POLL_INTERVAL_MS;
const MAX_BACKOFF_MS = 5000;

const CONVERSATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getPollTimeoutMs(): number {
  const ms = (globalThis as { __SOKOSUMI_TEST_POLL_TIMEOUT_MS?: number })
    .__SOKOSUMI_TEST_POLL_TIMEOUT_MS;
  if (typeof ms === "number" && ms > 0) return ms;
  return DEFAULT_POLL_TIMEOUT_MS;
}

function isConversationUuid(value: string): boolean {
  return CONVERSATION_UUID_RE.test(value.trim());
}

function isWarmupResultOk(
  result: unknown,
): result is { ok: true; data: ConversationWarmupData } {
  return (
    result != null &&
    typeof result === "object" &&
    "ok" in result &&
    (result as { ok: boolean }).ok === true &&
    "data" in result
  );
}

export interface UseConversationWarmupParams {
  conversationId: string | null;
  enabled: boolean;
}

export interface UseConversationWarmupResult {
  warmupState: ConversationWarmupData["state"] | null;
  warmupPending: boolean;
  warmupFailed: boolean;
}

export function useConversationWarmup({
  conversationId,
  enabled,
}: UseConversationWarmupParams): UseConversationWarmupResult {
  const [warmupState, setWarmupState] = useState<
    ConversationWarmupData["state"] | null
  >(null);
  const [warmupPending, setWarmupPending] = useState(false);
  const [warmupFailed, setWarmupFailed] = useState(false);
  const pollGenerationRef = useRef(0);

  useEffect(() => {
    if (!enabled || !conversationId || !isConversationUuid(conversationId)) {
      setWarmupState(null);
      setWarmupPending(false);
      setWarmupFailed(false);
      return;
    }

    const generation = pollGenerationRef.current;

    function isStale(): boolean {
      return pollGenerationRef.current !== generation;
    }

    void (async () => {
      const pollStartedAt = Date.now();
      const pollTimeoutMs = getPollTimeoutMs();
      let backoffMs = INITIAL_BACKOFF_MS;

      while (true) {
        if (isStale()) {
          setWarmupPending(false);
          return;
        }

        if (Date.now() - pollStartedAt >= pollTimeoutMs) {
          setWarmupPending(false);
          setWarmupFailed(true);
          return;
        }

        let fetchResult: unknown;
        let shouldBackoff = false;
        try {
          fetchResult = await getConversationWarmup({ conversationId });
        } catch {
          setWarmupPending(false);
          shouldBackoff = true;
        }

        if (isStale()) {
          setWarmupPending(false);
          return;
        }

        if (isWarmupResultOk(fetchResult)) {
          const { state } = fetchResult.data;
          setWarmupState(state);

          if (state === "ready" || state === "failed") {
            setWarmupPending(false);
            setWarmupFailed(state === "failed");
            return;
          }

          if (state === "pending") {
            setWarmupPending(true);
            setWarmupFailed(false);
            backoffMs = INITIAL_BACKOFF_MS;
          }
        } else {
          setWarmupPending(false);
          shouldBackoff = true;
        }

        const remaining = pollTimeoutMs - (Date.now() - pollStartedAt);
        if (remaining <= 0) {
          setWarmupPending(false);
          setWarmupFailed(true);
          return;
        }

        const sleep = Math.min(
          shouldBackoff ? backoffMs : POLL_INTERVAL_MS,
          Math.max(0, remaining),
        );
        await new Promise((r) => setTimeout(r, sleep));
        if (isStale()) {
          setWarmupPending(false);
          return;
        }

        if (shouldBackoff) {
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        }
      }
    })();

    return () => {
      pollGenerationRef.current += 1;
      setWarmupPending(false);
    };
  }, [conversationId, enabled]);

  return { warmupState, warmupPending, warmupFailed };
}
