import {
  makeChatRoomChannelName,
  makeOrgPresenceChannelName,
  makeUserChatControlChannelName,
  makeUserNotificationsChannelName,
  makeUserTasksChannelName,
} from "@sokosumi/utils";

type AblyClientCapabilityOp = "subscribe" | "presence" | "push-subscribe";

/**
 * Ably capability ops granted to browser clients. Typed as the exact op union
 * so the mint site can pass the map to Ably without an `as` cast, and so a new
 * op is one edit here rather than two.
 */
export type AblyClientCapabilityOps = AblyClientCapabilityOp[];

/** Ably capability map: channel name → ops. */
export interface AblySubscribeCapabilityMap {
  [channel: string]: AblyClientCapabilityOps;
}

export interface BuildAblyClientCapabilityInput {
  userId: string;
  roomIds: readonly string[];
  organizationIds: readonly string[];
}

/**
 * Ably capabilities for a user session.
 * - Chat rooms: per-membership room id subscribe (SOK-741)
 * - Chat control: always subscribe (SOK-742 membership revoke)
 * - Org presence: `presence` (enter/update/leave) + `subscribe` (get + presence
 *   events) on presence:org_* (ADR-0003; Ably requires both for roster maps)
 * - Notifications: `subscribe` (realtime feed) + `push-subscribe` (register this
 *   device for closed-app OS banners; ADR-0019)
 */
export function buildAblySubscribeCapability(
  userId: string,
  roomIds: readonly string[],
  organizationIds: readonly string[] = [],
): AblySubscribeCapabilityMap {
  return buildAblyClientCapability({
    userId,
    roomIds,
    organizationIds,
  });
}

export function buildAblyClientCapability({
  userId,
  roomIds,
  organizationIds,
}: BuildAblyClientCapabilityInput): AblySubscribeCapabilityMap {
  const capability: AblySubscribeCapabilityMap = {
    // Jobs channels use agent_id in the middle segment; wildcard keeps job pages working.
    [`agent_jobs:*:user_${userId}`]: ["subscribe"],
    [makeUserTasksChannelName(userId)]: ["subscribe"],
    [makeUserNotificationsChannelName(userId)]: ["subscribe", "push-subscribe"],
    [makeUserChatControlChannelName(userId)]: ["subscribe"],
  };

  for (const roomId of roomIds) {
    capability[makeChatRoomChannelName(roomId)] = ["subscribe"];
  }

  for (const organizationId of organizationIds) {
    capability[makeOrgPresenceChannelName(organizationId)] = [
      "presence",
      "subscribe",
    ];
  }

  return capability;
}
