import {
  makeChatRoomChannelName,
  makeUserNotificationsChannelName,
  makeUserTasksChannelName,
} from "@sokosumi/utils";

/** Ably capability map: channel name → ops (subscribe-only for clients). */
export type AblySubscribeCapabilityMap = {
  [channel: string]: ["subscribe"];
};

/**
 * Ably subscribe capabilities for a user session.
 * Chat rooms are granted per membership room id (SOK-741), not a user wildcard.
 */
export function buildAblySubscribeCapability(
  userId: string,
  roomIds: readonly string[],
): AblySubscribeCapabilityMap {
  const capability: AblySubscribeCapabilityMap = {
    // Jobs channels use agent_id in the middle segment; wildcard keeps job pages working.
    [`agent_jobs:*:user_${userId}`]: ["subscribe"],
    [makeUserTasksChannelName(userId)]: ["subscribe"],
    [makeUserNotificationsChannelName(userId)]: ["subscribe"],
  };

  for (const roomId of roomIds) {
    capability[makeChatRoomChannelName(roomId)] = ["subscribe"];
  }

  return capability;
}
