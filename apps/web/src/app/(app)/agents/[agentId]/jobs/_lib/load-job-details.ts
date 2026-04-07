import type { JobWithSokosumiStatus } from "@sokosumi/database";
import { resolveWorkspaceForContext } from "@sokosumi/database/helpers";
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

type SessionRecord = Session["session"] & {
  activeOrganizationId?: string | null;
};

// Cache repository calls to deduplicate queries across parallel routes
const getCachedAgent = cache(async (agentId: string) => {
  return agentRepository.getAgentWithRelationsById(agentId, prisma);
});

const getCachedJob = cache(async (jobId: string) => {
  return jobRepository.getJobById(jobId, prisma);
});

const getCachedWorkspace = cache(
  async (userId: string, organizationId: string) => {
    return await resolveWorkspaceForContext(userId, organizationId, prisma);
  },
);

function getActiveOrganizationId(session: Session): string | null {
  return (session.session as SessionRecord).activeOrganizationId ?? null;
}

async function canAccessJob(
  job: JobWithSokosumiStatus,
  session: Session,
): Promise<boolean> {
  const activeOrganizationId = getActiveOrganizationId(session);

  if (job.userId === session.user.id) {
    return true;
  }

  if (activeOrganizationId === null) {
    return false;
  }

  const workspace = await getCachedWorkspace(
    session.user.id,
    activeOrganizationId,
  );

  return job.workspaceId === workspace.id;
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
    activeOrganizationId: getActiveOrganizationId(session),
    dehydratedState: dehydrate(queryClient),
    job,
    personalWorkspaceLabel:
      session.user.name?.trim() || session.user.email?.trim() || null,
    readOnly: job.userId !== session.user.id,
  };
}
