import "server-only";

import { getCoreAgentById } from "@/lib/agents/core-loaders";
import type { CoreAgentDto } from "@/lib/types/core-dto";
import { parseMentions } from "@/lib/utils/mention-parser";

export function collectMentionedAgentIds(
  descriptions: ReadonlyArray<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const description of descriptions) {
    if (!description) continue;
    for (const mention of parseMentions(description)) {
      if (seen.has(mention.id)) continue;
      seen.add(mention.id);
      ids.push(mention.id);
    }
  }

  return ids;
}

export async function resolveMentionedAgentsById(
  descriptions: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, CoreAgentDto>> {
  const agentIds = collectMentionedAgentIds(descriptions);
  const agentsById = new Map<string, CoreAgentDto>();

  await Promise.all(
    agentIds.map(async (agentId) => {
      const agent = await getCoreAgentById(agentId);
      if (agent) {
        agentsById.set(agentId, agent);
      }
    }),
  );

  return agentsById;
}
