import {
  makeAgentJobsCapabilityResourceName,
  makeChatRoomChannelName,
  makeChatTypingChannelName,
  makeJobStatusChannelName,
  makeMainnetJobsCapabilityResourceName,
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
  /** The Workspaces the user may use Preprod in; empty while Preprod is off. */
  preprodJobWorkspaceIds: readonly string[];
  channelEnvironment: RealtimeChannelEnvironment;
}

/**
 * Ably capabilities for a user session.
 * - Job status: Mainnet by one wildcard over the user's Workspaces (it covers
 *   what the wildcard before it did); Preprod by one exact entry per Workspace
 *   with access, because a wildcard there would reach Workspaces without it
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
  preprodJobWorkspaceIds,
  channelEnvironment,
}: BuildAblyClientCapabilityInput): AblySubscribeCapabilityMap {
  const capability: AblySubscribeCapabilityMap = {
    // Nothing is published on these names any more. The grant only keeps a
    // tab opened before the rename attached, so it goes stale instead of
    // failing; it goes in the window cleanup.
    [makeAgentJobsCapabilityResourceName(userId, channelEnvironment)]: [
      "subscribe",
    ],
    [makeMainnetJobsCapabilityResourceName(userId, channelEnvironment)]: [
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

  for (const workspaceId of preprodJobWorkspaceIds) {
    capability[
      makeJobStatusChannelName(
        "preprod",
        workspaceId,
        userId,
        channelEnvironment,
      )
    ] = ["subscribe"];
  }

  return capability;
}
