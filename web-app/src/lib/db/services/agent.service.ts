import { Prisma } from "@prisma/client";

import prisma from "@/lib/db/prisma";

export const agentPricingInclude = {
  pricing: {
    include: { fixedPricing: { include: { amounts: true } } },
  },
} as const;

export const agentInclude = {
  ...agentPricingInclude,
  exampleOutput: true,
  overrideExampleOutput: true,
  tags: true,
  overrideTags: true,
  rating: true,
  userAgentRating: true,
} as const;

export type AgentWithRelations = Prisma.AgentGetPayload<{
  include: typeof agentInclude;
}>;

export async function getAgents(): Promise<AgentWithRelations[]> {
  return await prisma.agent.findMany({
    include: agentInclude,
  });
}

export async function getAgentById(
  id: string,
): Promise<AgentWithRelations | null> {
  return await prisma.agent.findUnique({
    where: { id },
    include: agentInclude,
  });
}
