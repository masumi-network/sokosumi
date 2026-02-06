/**
 * Ably channel name helpers for real-time communication.
 * These functions ensure consistent channel naming between publishers and subscribers.
 */

/**
 * Makes a channel name for task status updates scoped to a user.
 * Used by both the core API (publisher) and web app (subscriber).
 * @param userId - The ID of the user.
 * @returns The channel name.
 */
export function makeUserTasksChannelName(userId: string): string {
  return `tasks:all:user_${userId}`;
}
