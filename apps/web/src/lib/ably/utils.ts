export function getAgentJobsChannelName(): string {
  return "agent_jobs";
}

export function makeAgentJobsChannel(agentId: string, userId: string): string {
  return `agent_jobs:agent_${agentId}-user_${userId}`;
}
