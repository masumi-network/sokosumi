import { AgentDTO } from "@/lib/db/dto/AgentDTO";
import { prisma } from "@/lib/db/prisma";

export async function getAllAgents() {
  const agents = await prisma.agent.findMany({
    include: {
      Pricing: {
        include: { FixedPricing: { include: { Amounts: true } } },
      },
      ExampleOutput: true,
      ExampleOutputOverride: true,
      Rating: true,
      UserAgentRating: true,
    },
  });

  if (!agents) {
    throw new Error("No agents found");
  }

  return agents.map((agent) => new AgentDTO(agent));
}

export async function getAgentById(id: string) {
  const agent = await prisma.agent.findUnique({
    where: { id },
    include: {
      Pricing: {
        include: { FixedPricing: { include: { Amounts: true } } },
      },
      ExampleOutput: true,
      ExampleOutputOverride: true,
      Rating: true,
      UserAgentRating: true,
    },
  });

  if (!agent) {
    throw new Error(`Agent with ID ${id} not found`);
  }

  return new AgentDTO(agent);
}
