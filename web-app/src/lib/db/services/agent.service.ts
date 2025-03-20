import { unstable_cache } from "next/cache";

import prisma from "@/lib/db/prisma";
import { serializeBigInt } from "@/lib/utils";

import { AgentWithRelations } from "../agent/agent-helper";

const agentInclude = {
  Pricing: {
    include: { FixedPricing: { include: { Amounts: true } } },
  },
  ExampleOutput: true,
  ExampleOutputOverride: true,
  OverrideTags: true,
  OnChainTags: true,
  Rating: true,
  UserAgentRating: true,
} as const;

export const getCachedAgents = unstable_cache(
  async (): Promise<AgentWithRelations[]> => {
    return await getAgents();
  },
  ["agents"],
  {
    revalidate: 3600,
    tags: ["agents"],
  },
);

export async function getAgents(): Promise<AgentWithRelations[]> {
  const agents = await prisma.agent.findMany({
    include: agentInclude,
  });

  if (!agents) {
    throw new Error("No agents found");
  }

  return serializeBigInt(agents);
}

export async function getAgentById(id: string): Promise<AgentWithRelations> {
  const agent = await prisma.agent.findUnique({
    where: { id },
    include: agentInclude,
  });

  if (!agent) {
    throw new Error(`Agent with ID ${id} not found`);
  }

  return serializeBigInt(agent);
}
