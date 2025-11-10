/**
 * Makes a channel name for the agent jobs channel.
 * This channel can only be subscribed to by the user with given userId.
 * @param agentId - The ID of the agent.
 * @param userId - The ID of the user.
 * @returns The channel name.
 */
export function makeAgentJobsChannelName(
  agentId: string,
  userId: string,
): string {
  return `agent_jobs:agent_${agentId}:user_${userId}`;
}
