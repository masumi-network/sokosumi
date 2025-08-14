import "server-only";

import { AgentWithCreditsPrice, convertCentsToCredits } from "@/lib/db";
import { User } from "@/prisma/generated/client";

import { AgentResponse } from "./schemas";
import { dateToISO } from "./utils";

/**
 * Formats user data for API response
 */
export function formatUserResponse(user: User) {
  return {
    user: {
      id: user.id,
      createdAt: dateToISO(user.createdAt),
      updatedAt: dateToISO(user.updatedAt),
      name: user.name,
      email: user.email,
      termsAccepted: user.termsAccepted,
      marketingOptIn: user.marketingOptIn,
      stripeCustomerId: user.stripeCustomerId,
    },
  };
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
