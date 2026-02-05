/**
 * Channel for task status updates scoped to a user.
 */
export function makeUserTasksChannelName(userId: string): string {
  return `tasks:all:user_${userId}`;
}
