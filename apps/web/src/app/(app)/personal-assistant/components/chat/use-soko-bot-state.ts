import { useCallback, useEffect, useRef, useState } from "react";

import { useSokoBotActivityProbe } from "@/hooks/effects/use-soko-bot-activity-probe";
import { withBotIdParam } from "@/lib/soko-bot/bot-id-param";
import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";

const STATE_ENDPOINT = "/api/personal-assistant/state";
const ACTIVITY_ENDPOINT = "/api/personal-assistant/activity";
/** A state read that outlives this is abandoned rather than held onto. */
const STATE_TIMEOUT_MS = 15_000;

/**
 * Keeps the chat projection fresh.
 *
 * Two endpoints, deliberately. The probe is one indexed read and runs often
 * enough to notice a turn while it is still running; the full state loads the
 * bot plus twenty turns with their events and decisions, and is fetched only
 * when the probe says something moved, or while a turn is in flight.
 *
 * `botId` watches a shared bot; without it, the caller's own.
 */
export function useSokoBotState(
  initial: SokoBotChatState,
  botId?: string | null,
) {
  const stateEndpoint = withBotIdParam(STATE_ENDPOINT, botId);
  const activityEndpoint = withBotIdParam(ACTIVITY_ENDPOINT, botId);
  const [state, setState] = useState(initial);
  const refreshing = useRef(false);
  const queued = useRef(false);

  useEffect(() => {
    setState(initial);
  }, [initial]);

  const refresh = useCallback(async () => {
    // Coalesced, not dropped, and never cancelled.
    //
    // Cancelling was the first bug: a /state read slower than one probe tick
    // was aborted by the next one, so only the read after the turn settled
    // ever landed. Plain skipping was the second: the tick that saw the turn
    // settle could have its read skipped, the slow in-flight response would
    // then restore the running state, and since the signature had already
    // been recorded no later tick would ask again — the orb stuck forever.
    // One queued follow-up read fixes that without stacking requests.
    if (refreshing.current) {
      queued.current = true;
      return;
    }
    refreshing.current = true;
    try {
      do {
        queued.current = false;
        // A request that never settles would otherwise hold the flag and stop
        // every future read, which is worse than the bug above. Built from a
        // controller rather than `AbortSignal.timeout` so the deadline is
        // ordinary code a test can drive.
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), STATE_TIMEOUT_MS);
        try {
          const response = await fetch(stateEndpoint, {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) return;
          const body = (await response.json()) as {
            state?: SokoBotChatState | null;
          };
          if (body.state) setState(body.state);
        } finally {
          clearTimeout(deadline);
        }
      } while (queued.current);
    } catch {
      // Offline or timed out: the next tick retries.
    } finally {
      refreshing.current = false;
    }
  }, [stateEndpoint]);

  useSokoBotActivityProbe(activityEndpoint, refresh);

  return { state, refresh };
}
