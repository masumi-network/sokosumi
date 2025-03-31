import { AgentWithRelations } from "@/lib/db/extension/agent";
import prisma from "@/lib/db/prisma";

const agentInclude = {
  pricing: {
    include: { fixedPricing: { include: { amounts: true } } },
  },
  exampleOutput: true,
  overrideExampleOutput: true,
  tags: true,
  overrideTags: true,
  rating: true,
  userAgentRating: true,
} as const;

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
