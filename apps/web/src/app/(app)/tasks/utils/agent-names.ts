import type { Agent, AgentWithCreditsPrice } from "@sokosumi/utils";

import { getAgentName } from "@/lib/helpers/agent";

export function buildAgentNameById(
  agents: (Agent | AgentWithCreditsPrice)[],
): Map<string, string> {
  const agentNameById = new Map<string, string>();
  for (const agent of agents) {
    agentNameById.set(agent.id, getAgentName(agent));
  }
  return agentNameById;
}

export function convertAgentNamesToMentionOptions(
  agentNameById: Map<string, string>,
): Record<string, { value: string }> {
  return Object.fromEntries(
    Array.from(agentNameById.entries()).map(([agentId, name]) => [
      agentId,
      { value: name },
    ]),
  );
}
