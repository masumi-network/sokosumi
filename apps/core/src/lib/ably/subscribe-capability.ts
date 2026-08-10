import {
  makeChatRoomChannelName,
  makeOrgPresenceChannelName,
  makeUserChatControlChannelName,
  makeUserNotificationsChannelName,
  makeUserTasksChannelName,
} from "@sokosumi/utils";

/** Ably capability ops granted to browser clients. */
export type AblyClientCapabilityOps = string[];

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
 * - Org presence: Ably `presence` op only (enter/update/leave + presence events; ADR-0002)
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
    [makeUserNotificationsChannelName(userId)]: ["subscribe"],
    [makeUserChatControlChannelName(userId)]: ["subscribe"],
  };

  for (const roomId of roomIds) {
    capability[makeChatRoomChannelName(roomId)] = ["subscribe"];
  }

  for (const organizationId of organizationIds) {
    capability[makeOrgPresenceChannelName(organizationId)] = ["presence"];
  }

  return capability;
}
