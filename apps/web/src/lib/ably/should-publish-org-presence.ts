import type { ChatPresenceMemberData } from "@sokosumi/utils";

/** Refresh lastActiveAt just inside the 5 min Online window (SOK-894). */
export const ORG_PRESENCE_PUBLISH_MIN_INTERVAL_MS = 4 * 60 * 1000;

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
