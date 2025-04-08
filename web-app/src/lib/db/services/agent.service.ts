import { Prisma } from "@prisma/client";

import { getPaymentInformation } from "@/lib/api/generated/registry";
import { getRegistryClient } from "@/lib/api/registry-service.client";
import { getApiBaseUrl } from "@/lib/db/extension/agent";
import { inputSchemaMock } from "@/lib/db/mocks/input-schema";
import prisma from "@/lib/db/prisma";
import { jobInputsDataSchema, JobInputsDataSchemaType } from "@/lib/job-input";

import { getOrCreateFavoriteAgentList } from "./agentList.service";

const agentPricingInclude = {
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
    where: {
      isShown: true,
    },
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

export async function getFavoriteAgents(userId: string) {
  const list = await getOrCreateFavoriteAgentList(userId);
  return list.agents;
}

export async function getHiredAgentsOrderedByLatestJob(userId: string) {
  const agentsWithJobs = await prisma.agent.findMany({
    where: {
      jobs: {
        some: {
          userId: userId,
        },
      },
    },
    include: {
      jobs: {
        where: {
          userId: userId,
        },
        orderBy: {
          startedAt: "desc",
        },
        take: 1,
      },
    },
  });
  // Then sort them manually by the startedAt of the most recent job
  return agentsWithJobs.sort((a, b) => {
    const aLatestJob = a.jobs[0];
    const bLatestJob = b.jobs[0];

    // If either agent has no jobs, put them at the end
    if (!aLatestJob) return 1;
    if (!bLatestJob) return -1;

    // Sort by startedAt descending (newest first)
    return bLatestJob.startedAt.getTime() - aLatestJob.startedAt.getTime();
  });
}

export async function getAgentInputSchema(
  agentId: string,
): Promise<JobInputsDataSchemaType> {
  const agent = await getAgentById(agentId);

  if (!agent) {
    throw new Error(`Agent with ID ${agentId} not found`);
  }

  const baseUrl = getApiBaseUrl(agent);
  const inputSchemaUrl = new URL(`/input_schema`, baseUrl);

  try {
    const response = await fetch(inputSchemaUrl);
    const schema = await response.json();

    const inputSchema = jobInputsDataSchema(undefined).parse(schema);

    return inputSchema;
  } catch (error) {
    console.error("Error fetching agent input schema", error);
    return inputSchemaMock;
  }
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
      agentIdentifier: agent.blockchainIdentifier,
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
