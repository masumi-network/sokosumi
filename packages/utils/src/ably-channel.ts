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

/** Shared room-scoped channel for chat_room_message fan-out (SOK-741). */
export const CHAT_ROOM_CHANNEL_PREFIX = "chat_rooms:room_";

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
