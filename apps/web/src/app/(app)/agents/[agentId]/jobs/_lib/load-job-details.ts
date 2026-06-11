import { dehydrate } from "@tanstack/react-query";
import { notFound } from "next/navigation";
import { cache } from "react";

import { getSession } from "@/lib/auth/utils";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { Job } from "@/lib/clients/generated/core";
import { projectService } from "@/lib/services/project.service";
import { getJobQueryKey, getQueryClient } from "@/queries";

interface LoadJobDetailsParams {
  agentId: string;
  jobId: string;
}

interface LoadJobDetailsResult {
  activeOrganizationId: string | null;
  dehydratedState: ReturnType<typeof dehydrate>;
  job: Job;
  personalWorkspaceLabel: string | null;
  projectName: string | null;
  readOnly: boolean;
}

const getCachedJob = cache(async (jobId: string) => {
  try {
    const response = await coreClient.getJobById(jobId);
    // Core `Job` is consumed as-is; the generated client transformers already
    // revive its `Date` fields. The same shape is seeded into the query cache
    // below, matching what the `getJob` server action returns on refetch.
    return response.data;
  } catch (error) {
    if (error instanceof CoreApiRequestError && error.status === 404) {
      return null;
    }

    throw error;
  }
});

export async function loadJobDetails({
  agentId,
  jobId,
}: LoadJobDetailsParams): Promise<LoadJobDetailsResult> {
  const session = await getSession();
  if (!session) {
    notFound();
  }

  const job = await getCachedJob(jobId);
  if (!job || job.agent.id !== agentId) {
    notFound();
  }

  const queryClient = getQueryClient();
  queryClient.setQueryData(getJobQueryKey(jobId), job);
  const project = job.projectId
    ? await projectService.getProjectById(job.projectId)
    : null;

  return {
    activeOrganizationId: session.session.activeOrganizationId ?? null,
    dehydratedState: dehydrate(queryClient),
    job,
    personalWorkspaceLabel:
      session.user.name?.trim() || session.user.email?.trim() || null,
    projectName: project?.name ?? null,
    readOnly: job.userId !== session.user.id,
  };
}
