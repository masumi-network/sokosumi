import type { JobWithSokosumiStatus } from "@sokosumi/database";
import {
  agentRepository,
  jobRepository,
} from "@sokosumi/database/repositories";
import { dehydrate } from "@tanstack/react-query";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import type { Session } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";
import { getJobQueryKey, getQueryClient } from "@/queries";

interface LoadJobDetailsParams {
  agentId: string;
  jobId: string;
  redirectTo?: string;
}

interface LoadJobDetailsResult {
  activeOrganizationId: string | null;
  dehydratedState: ReturnType<typeof dehydrate>;
  job: JobWithSokosumiStatus;
  personalWorkspaceLabel: string | null;
  readOnly: boolean;
}

// Cache repository calls to deduplicate queries across parallel routes
const getCachedAgent = cache(async (agentId: string) => {
  return agentRepository.getAgentWithRelationsById(agentId, prisma);
});

const getCachedJob = cache(async (jobId: string) => {
  return jobRepository.getJobById(jobId, prisma);
});

async function canAccessJob(
  job: JobWithSokosumiStatus,
  session: Session,
): Promise<boolean> {
  return job.userId === session.user.id;
}

export async function loadJobDetails({
  agentId,
  jobId,
  redirectTo,
}: LoadJobDetailsParams): Promise<LoadJobDetailsResult> {
  const session = await getSession();
  if (!session) {
    notFound();
  }

  const agent = await getCachedAgent(agentId);
  if (!agent) {
    notFound();
  }

  const job = await getCachedJob(jobId);
  if (!job || job.agent.id !== agentId) {
    notFound();
  }

  const hasAccess = await canAccessJob(job, session);
  if (!hasAccess) {
    redirect(redirectTo ?? `/agents/${agentId}/jobs`);
  }

  const queryClient = getQueryClient();
  queryClient.setQueryData(getJobQueryKey(jobId), job);

  return {
    activeOrganizationId: session.session.activeOrganizationId ?? null,
    dehydratedState: dehydrate(queryClient),
    job,
    personalWorkspaceLabel:
      session.user.name?.trim() || session.user.email?.trim() || null,
    readOnly: job.userId !== session.user.id,
  };
}
