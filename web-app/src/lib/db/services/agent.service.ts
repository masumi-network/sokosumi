import { unstable_cache } from "next/cache";

import { AgentDTO, createAgentDTO } from "@/lib/db/dto/AgentDTO";
import prisma from "@/lib/db/prisma";

const agentInclude = {
  Pricing: {
    include: { FixedPricing: { include: { Amounts: true } } },
  },
  ExampleOutput: true,
  ExampleOutputOverride: true,
  Rating: true,
  UserAgentRating: true,
} as const;

export const getCachedAgents = unstable_cache(
  async (): Promise<AgentDTO[]> => {
    return await getAgents();
  },
  ["agents"],
  {
    revalidate: 3600,
    tags: ["agents"],
  },
);

export async function getAgents(): Promise<AgentDTO[]> {
  const agents = await prisma.agent.findMany({
    include: agentInclude,
  });

  return agents.map((agent) => createAgentDTO(agent));
}

export async function getAgentById(id: string): Promise<AgentDTO> {
  const agent = await prisma.agent.findUnique({
    where: { id },
    include: agentInclude,
  });

  if (!agent) {
    throw new Error(`Agent with ID ${id} not found`);
  }

  return createAgentDTO(agent);
}

export const getCachedAgentsTags = unstable_cache(
  async (): Promise<string[]> => {
    return await getAgentsTags();
  },
  ["agents-tags"],
  {
    revalidate: 3600,
    tags: ["agents-tags"],
  },
);

export async function getAgentsTags(): Promise<string[]> {
  const tagsResult = await prisma.agent.findMany({
    select: { onChainTags: true, overrideTags: true },
    distinct: ["onChainTags", "overrideTags"],
  });
  const tags = tagsResult
    .map((result) => [...result.onChainTags, ...result.overrideTags])
    .flat();
  return tags;
}
