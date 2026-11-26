import { useSokoBotActivityProbe } from "@/hooks/effects/use-soko-bot-activity-probe";
import { useSokoBotStateSync } from "@/hooks/effects/use-soko-bot-state-sync";
import { withBotIdParam } from "@/lib/soko-bot/bot-id-param";
import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";

const STATE_ENDPOINT = "/api/personal-assistant/state";
const ACTIVITY_ENDPOINT = "/api/personal-assistant/activity";

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
  const { state, refresh } = useSokoBotStateSync(initial, stateEndpoint);

  useSokoBotActivityProbe(activityEndpoint, refresh);

  return { state, refresh };
}
