import { AgentDTO, createAgentDTO } from "@/lib/db/dto/AgentDTO";
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

export async function getAgents(): Promise<AgentDTO[]> {
  const agents = await prisma.agent.findMany({
    include: agentInclude,
  });

  if (!agents) {
    throw new Error("No agents found");
  }

  return await Promise.all(agents.map(createAgentDTO));
}

export async function getAgentById(id: string): Promise<AgentDTO> {
  const agent = await prisma.agent.findUnique({
    where: { id },
    include: agentInclude,
  });

  if (!agent) {
    throw new Error(`Agent with ID ${id} not found`);
  }

  return await createAgentDTO(agent);
}
