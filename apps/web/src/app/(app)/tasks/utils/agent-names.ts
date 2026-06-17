import type { Agent } from "@/lib/clients/generated/core";
import { getAgentName } from "@/lib/helpers/agent";
import type { CoreAgentDto } from "@/lib/types/core-dto";

export function buildAgentNameById(
  agents: (Agent | CoreAgentDto)[],
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
