export function getAgentJobsChannelName(): string {
  return "job_status_update";
}

export function makeAgentJobsChannel(agentId: string, userId: string): string {
  return `agent-jobs:${agentId}-${userId}`;
}
