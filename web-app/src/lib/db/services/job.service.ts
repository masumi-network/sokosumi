import { Prisma } from "@prisma/client";

import prisma from "@/lib/db/prisma";

const jobInclude = {
  agent: true,
  user: true,
} as const;

const jobOrderBy = {
  createdAt: "desc",
} as const;

export type JobWithRelations = Prisma.JobGetPayload<{
  include: typeof jobInclude;
}>;

/**
 * Retrieves all jobs associated with a specific agent and user
 * @param agentId - The unique identifier of the agent
 * @param userId - The unique identifier of the user
 * @returns Promise containing an array of jobs with their relations
 */
export async function getJobsByAgentId(
  agentId: string,
  userId: string,
): Promise<JobWithRelations[]> {
  const jobs = await prisma.job.findMany({
    where: {
      agentId,
      userId,
    },
    include: jobInclude,
    orderBy: jobOrderBy,
  });

  if (!jobs) {
    return [];
  }

  return jobs;
}

/**
 * Retrieves all jobs associated with a specific user
 * @param userId - The unique identifier of the user
 * @returns Promise containing an array of jobs with their relations
 */
export async function getJobs(userId: string) {
  const jobs = await prisma.job.findMany({
    where: {
      userId,
    },
    include: jobInclude,
    orderBy: jobOrderBy,
  });

  return jobs;
}
