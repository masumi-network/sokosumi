import "server-only";

import { AgentWithCreditsPrice } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";

import { AgentResponse, agentResponseSchema } from "@/lib/api/schemas";
import { dateToISO } from "@/lib/api/utils";

/**
 * Formats agent data for API response with BigInt conversion
 */
export function formatAgentResponse(
  agent: AgentWithCreditsPrice,
): AgentResponse {
  const formatted = {
    id: agent.id,
    createdAt: dateToISO(agent.createdAt),
    updatedAt: dateToISO(agent.updatedAt),
    name: agent.name,
    description: agent.description,
    status: agent.status,
    isShown: agent.isShown,
    price: {
      credits: convertCentsToCredits(agent.creditsPrice.cents),
      includedFee: convertCentsToCredits(agent.creditsPrice.includedFee),
    },
    tags: agent.tags.map((tag) => ({
      name: tag.name,
    })),
  };

  // Validate the formatted response
  return agentResponseSchema.parse(formatted);
}
