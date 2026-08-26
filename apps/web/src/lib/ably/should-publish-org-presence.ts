import {
  CHAT_PRESENCE_ONLINE_WINDOW_MS,
  type ChatPresenceMemberData,
} from "@sokosumi/utils";

/** Slack so a throttled refresh arrives before teammates age you to AFK. */
const ORG_PRESENCE_PUBLISH_MARGIN_MS = 60_000;

/** Refresh lastActiveAt just inside the shared Online window (SOK-894). */
export const ORG_PRESENCE_PUBLISH_MIN_INTERVAL_MS =
  CHAT_PRESENCE_ONLINE_WINDOW_MS - ORG_PRESENCE_PUBLISH_MARGIN_MS;

export interface ShouldPublishOrgPresenceUpdateInput {
  force: boolean;
  next: ChatPresenceMemberData;
  lastPublished: ChatPresenceMemberData | null;
  lastPublishedAt: number;
  now: number;
  minIntervalMs: number;
}

/**
 * Idle/unchanged presence must not emit Ably messages. Activity refreshes
 * lastActiveAt on a throttle just inside the online window. Visibility,
 * enter, and reconnect force an immediate publish.
 */
export function shouldPublishOrgPresenceUpdate(
  input: ShouldPublishOrgPresenceUpdateInput,
): boolean {
  if (input.force || input.lastPublished == null) {
    return true;
  }
  if (input.next.visible !== input.lastPublished.visible) {
    return true;
  }
  if (input.next.lastActiveAt === input.lastPublished.lastActiveAt) {
    return false;
  }
  return input.now - input.lastPublishedAt >= input.minIntervalMs;
}
