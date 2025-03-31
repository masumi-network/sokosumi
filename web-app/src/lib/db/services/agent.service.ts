import { Prisma } from "@prisma/client";

import prisma from "@/lib/db/prisma";

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
