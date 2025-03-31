import { getPaymentInformation } from "@/lib/api/generated/registry";
import { getRegistryClient } from "@/lib/api/registry-service.client";
import { AgentDTO, createAgentDTO } from "@/lib/db/dto/AgentDTO";
import prisma from "@/lib/db/prisma";
import { jobInputSchema } from "@/lib/job-input";

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

export async function getAgentInputSchema(agentId: string) {
  const agent = await getAgentById(agentId);

  const agentUrl = agent.apiBaseUrl;

  if (!agentUrl) {
    throw new Error(`Agent with ID ${agentId} has no API base URL`);
  }

  let agentUrlString = agentUrl.toString();
  if (agentUrlString.endsWith("/")) {
    agentUrlString = agentUrlString.slice(0, -1);
  }

  const response = await fetch(`${agentUrlString}/input_schema`);
  const schema = await response.json();
  const inputSchema = jobInputSchema(undefined).parse(schema);

  return inputSchema;
}

export async function getAgentPricing(agentId: string) {
  const agent = await getAgentById(agentId);

  if (!agent) {
    throw new Error("Agent not found");
  }
  const registryClient = getRegistryClient();

  const paymentInformation = await getPaymentInformation({
    client: registryClient,
    query: {
      agentIdentifier: agent.onChainIdentifier,
    },
  });

  if (
    !paymentInformation ||
    !paymentInformation.data ||
    !paymentInformation.data.data
  ) {
    throw new Error("Payment information not found or invalid price");
  }
  return paymentInformation.data.data.AgentPricing;
}
