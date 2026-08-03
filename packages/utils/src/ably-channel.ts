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

export function makeUserChatRoomsChannelName(userId: string): string {
  return `chat_rooms:all:user_${userId}`;
}
