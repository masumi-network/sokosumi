import "server-only";

import { AgentWithCreditsPrice, convertCentsToCredits } from "@/lib/db";
import { User } from "@/prisma/generated/client";

import { AgentResponse, UserResponse, userResponseSchema } from "./schemas";
import { dateToISO } from "./utils";

/**
 * Formats user data for API response
 */
export function formatUserResponse(user: User): UserResponse {
  const userResponse = userResponseSchema.parse(user);
  return userResponse;
}

/**
 * Formats agent data for API response with BigInt conversion
 */
export function formatAgentResponse(
  agent: AgentWithCreditsPrice,
): AgentResponse {
  return {
    id: agent.id,
    createdAt: dateToISO(agent.createdAt),
    updatedAt: dateToISO(agent.updatedAt),
    name: agent.name,
    description: agent.description,
    status: agent.status,
    isNew: agent.isNew,
    isShown: agent.isShown,
    price: {
      credits: convertCentsToCredits(agent.creditsPrice.cents),
      includedFee: convertCentsToCredits(agent.creditsPrice.includedFee),
    },
    tags: agent.tags.map((tag) => ({
      name: tag.name,
    })),
  };
}
