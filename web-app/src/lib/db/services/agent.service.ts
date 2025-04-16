"use server";
import { getPaymentInformation } from "@/lib/api/generated/registry";
import { getRegistryClient } from "@/lib/api/registry-service.client";
import { getApiBaseUrl } from "@/lib/db/extension/agent";
import prisma from "@/lib/db/prisma";
import {
  agentInclude,
  agentPricingInclude,
  AgentWithRelations,
} from "@/lib/db/types/agent.types";
import { jobInputsDataSchema, JobInputsDataSchemaType } from "@/lib/job-input";
import { Prisma } from "@/prisma/generated/client";

import { getOrCreateFavoriteAgentList } from "./agentList.service";

export async function getAgents(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  return await tx.agent.findMany({
    include: agentInclude,
    where: {
      isShown: true,
    },
  });
}

export async function getAgentById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations | null> {
  return await tx.agent.findUnique({
    where: { id },
    include: agentInclude,
  });
}

export async function getFavoriteAgents(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const list = await getOrCreateFavoriteAgentList(userId, tx);
  return list.agents;
}

export async function getHiredAgentsOrderedByLatestJob(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const agentsWithJobs = await tx.agent.findMany({
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
  tx: Prisma.TransactionClient = prisma,
): Promise<JobInputsDataSchemaType> {
  const agent = await getAgentById(agentId, tx);

  if (!agent) {
    throw new Error(`Agent with ID ${agentId} not found`);
  }

  const baseUrl = getApiBaseUrl(agent);
  const inputSchemaUrl = new URL(`/input_schema`, baseUrl);

  const response = await fetch(inputSchemaUrl);
  const schema = await response.json();

  const inputSchema = jobInputsDataSchema(undefined).parse(schema);

  return inputSchema;
}

export async function getAgentPricing(
  agentId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const agent = await tx.agent.findUnique({
    where: { id: agentId },
    include: agentPricingInclude,
  });

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
