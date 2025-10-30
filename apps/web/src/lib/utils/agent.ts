import { Agent } from "@sokosumi/database";

import { getEnvPublicConfig } from "@/config/env.public";

/**
 * Determines if an agent is considered "new" based on its creation date.
 * An agent is new if it was created within the threshold days configured in the environment.
 *
 * @param agent - The agent to check
 * @returns true if the agent was created within the threshold, false otherwise
 */
export function isAgentNew(agent: Agent): boolean {
  const thresholdDays =
    getEnvPublicConfig().NEXT_PUBLIC_AGENT_NEW_THRESHOLD_DAYS;
  const thresholdMilliseconds = 86_400_000 * thresholdDays;

  return agent.createdAt > new Date(Date.now() - thresholdMilliseconds);
}
