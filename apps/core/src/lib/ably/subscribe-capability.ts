import {
  makeAgentJobsCapabilityResourceName,
  makeChatRoomChannelName,
  makeChatTypingChannelName,
  makeOrgPresenceChannelName,
  makeUserCalendarControlChannelName,
  makeUserChatControlChannelName,
  makeUserNotificationsChannelName,
  makeUserTasksChannelName,
  makeWorkspaceCalendarChannelName,
  type RealtimeChannelEnvironment,
} from "@sokosumi/utils";

type AblyClientCapabilityOp =
  | "subscribe"
  | "presence"
  | "publish"
  | "push-subscribe";

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
  workspaceIds: readonly string[];
  channelEnvironment: RealtimeChannelEnvironment;
}

/**
 * Ably capabilities for a user session.
 * - Chat rooms: per-membership room id subscribe (SOK-741)
 * - Chat control: always subscribe (SOK-742 membership revoke)
 * - Calendar workspaces: exact per-workspace, per-user subscribe
 * - Calendar control: always subscribe so access revocation can detach clients
 * - Org presence: `presence` (enter/update/leave) + `subscribe` (get + presence
 *   events) on presence:org_* (ADR-0003; Ably requires both for roster maps)
 * - Notifications: `subscribe` (realtime feed) + `presence` (a client enters
 *   while it is in front, so Core can hold a notification email back for a
 *   reader who is looking; SOK-1090) + `push-subscribe` (register this device
 *   for closed-app OS banners; ADR-0022)
 */
export function buildAblyClientCapability({
  userId,
  roomIds,
  organizationIds,
  workspaceIds,
  channelEnvironment,
}: BuildAblyClientCapabilityInput): AblySubscribeCapabilityMap {
  const capability: AblySubscribeCapabilityMap = {
    // Jobs channels use agent_id in the middle segment; wildcard keeps job pages working.
    [makeAgentJobsCapabilityResourceName(userId, channelEnvironment)]: [
      "subscribe",
    ],
    [makeUserTasksChannelName(userId, channelEnvironment)]: ["subscribe"],
    [makeUserNotificationsChannelName(userId, channelEnvironment)]: [
      "subscribe",
      "presence",
      "push-subscribe",
    ],
    [makeUserChatControlChannelName(userId, channelEnvironment)]: ["subscribe"],
    [makeUserCalendarControlChannelName(userId, channelEnvironment)]: [
      "subscribe",
    ],
  };

  for (const roomId of roomIds) {
    capability[makeChatRoomChannelName(roomId, channelEnvironment)] = [
      "subscribe",
    ];
    // Typing gets its own channel so `publish` never lands on the message
    // channel, where a member could forge a chat_room_message (ADR-0033).
    capability[makeChatTypingChannelName(roomId, channelEnvironment)] = [
      "publish",
      "subscribe",
    ];
  }

  for (const organizationId of organizationIds) {
    capability[makeOrgPresenceChannelName(organizationId, channelEnvironment)] =
      ["presence", "subscribe"];
  }

  for (const workspaceId of workspaceIds) {
    capability[
      makeWorkspaceCalendarChannelName(workspaceId, userId, channelEnvironment)
    ] = ["subscribe"];
  }

  return capability;
}
