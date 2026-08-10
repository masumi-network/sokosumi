/**
 * Ably channel name helpers for real-time communication.
 * These functions are shared by publishers and subscribers and must stay
 * client-safe.
 */

export function makeAgentJobsChannelName(
  agentId: string,
  userId: string,
): string {
  return `agent_jobs:agent_${agentId}:user_${userId}`;
}

export function makeUserTasksChannelName(userId: string): string {
  return `tasks:all:user_${userId}`;
}

export function makeUserNotificationsChannelName(userId: string): string {
  return `notifications:all:user_${userId}`;
}

/**
 * Per-user chat control channel (membership revoke, etc.). Always granted on
 * the subscribe token so remote kicks can signal without room caps (SOK-742).
 */
export function makeUserChatControlChannelName(userId: string): string {
  return `chat_control:user_${userId}`;
}

/** Shared room-scoped channel for chat_room_message fan-out (SOK-741). */
const CHAT_ROOM_CHANNEL_PREFIX = "chat_rooms:room_";

export function makeChatRoomChannelName(roomId: string): string {
  return `${CHAT_ROOM_CHANNEL_PREFIX}${roomId}`;
}

/**
 * Inverse of {@link makeChatRoomChannelName}. Returns null for non-room channels
 * (jobs/tasks/notifications wildcards, empty id, etc.).
 */
export function parseChatRoomIdFromChannelName(
  channelName: string,
): string | null {
  if (!channelName.startsWith(CHAT_ROOM_CHANNEL_PREFIX)) {
    return null;
  }
  const roomId = channelName.slice(CHAT_ROOM_CHANNEL_PREFIX.length);
  return roomId.length > 0 ? roomId : null;
}

/** Org-scoped Ably Presence channel (ADR-0002). */
const ORG_PRESENCE_CHANNEL_PREFIX = "presence:org_";

export function makeOrgPresenceChannelName(organizationId: string): string {
  return `${ORG_PRESENCE_CHANNEL_PREFIX}${organizationId}`;
}

/**
 * Inverse of {@link makeOrgPresenceChannelName}. Null when not an org presence
 * channel or empty org id.
 */
export function parseOrganizationIdFromPresenceChannelName(
  channelName: string,
): string | null {
  if (!channelName.startsWith(ORG_PRESENCE_CHANNEL_PREFIX)) {
    return null;
  }
  const organizationId = channelName.slice(ORG_PRESENCE_CHANNEL_PREFIX.length);
  return organizationId.length > 0 ? organizationId : null;
}
