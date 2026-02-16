import { type JobWithSokosumiStatus } from "@sokosumi/database";
import {
  agentRepository,
  jobRepository,
} from "@sokosumi/database/repositories";
import { dehydrate } from "@tanstack/react-query";
import { notFound, redirect } from "next/navigation";

import { type Session } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";
import { isSharedWithOrganization } from "@/lib/helpers/job";
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
  readOnly: boolean;
}

async function canAccessJob(
  job: JobWithSokosumiStatus,
  session: Session,
): Promise<boolean> {
  if (job.userId === session.user.id) {
    return job.organizationId === session.session.activeOrganizationId;
  }

  if (
    session.session.activeOrganizationId &&
    isSharedWithOrganization(job, session.session.activeOrganizationId)
  ) {
    return true;
  }

  return false;
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

  const agent = await agentRepository.getAgentWithRelationsById(
    agentId,
    prisma,
  );
  if (!agent) {
    notFound();
  }

  const job = await jobRepository.getJobById(jobId, prisma);
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
    readOnly: job.userId !== session.user.id,
  };
}
