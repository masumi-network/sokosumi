"use client";

import { useEffect, useRef, useState } from "react";
import type { ConversationWarmupData } from "@/lib/actions/conversation/core-api-actions";
import { getConversationWarmup } from "@/lib/actions/conversation/core-api-actions";

const DEFAULT_POLL_TIMEOUT_MS = 30_000;
const INITIAL_BACKOFF_MS = 2000;
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
  isWarmupPending: boolean;
}

export function useConversationWarmup({
  conversationId,
  enabled,
}: UseConversationWarmupParams): UseConversationWarmupResult {
  const [warmupState, setWarmupState] = useState<
    ConversationWarmupData["state"] | null
  >(null);
  const [isWarmupPending, setIsWarmupPending] = useState(false);
  const pollGenerationRef = useRef(0);

  useEffect(() => {
    if (!enabled || !conversationId || !isConversationUuid(conversationId)) {
      setWarmupState(null);
      setIsWarmupPending(false);
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
          setIsWarmupPending(false);
          return;
        }

        if (Date.now() - pollStartedAt >= pollTimeoutMs) {
          setIsWarmupPending(false);
          return;
        }

        let fetchResult: unknown;
        try {
          fetchResult = await getConversationWarmup({ conversationId });
        } catch {
          setIsWarmupPending(false);
        }

        if (isStale()) {
          setIsWarmupPending(false);
          return;
        }

        if (isWarmupResultOk(fetchResult)) {
          const { state } = fetchResult.data;
          setWarmupState(state);

          if (state === "ready" || state === "failed") {
            setIsWarmupPending(false);
            return;
          }

          if (state === "pending") {
            setIsWarmupPending(true);
          }
        } else {
          setIsWarmupPending(false);
        }

        const remaining = pollTimeoutMs - (Date.now() - pollStartedAt);
        if (remaining <= 0) {
          setIsWarmupPending(false);
          return;
        }

        const sleep = Math.min(backoffMs, Math.max(0, remaining));
        await new Promise((r) => setTimeout(r, sleep));
        if (isStale()) {
          setIsWarmupPending(false);
          return;
        }

        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      }
    })();

    return () => {
      pollGenerationRef.current += 1;
      setIsWarmupPending(false);
    };
  }, [conversationId, enabled]);

  return { warmupState, isWarmupPending };
}
