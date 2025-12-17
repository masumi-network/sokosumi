import { JobWithSokosumiStatus } from "@sokosumi/database";
import {
  agentRepository,
  jobRepository,
} from "@sokosumi/database/repositories";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { notFound, redirect } from "next/navigation";

import { JobDetails } from "@/components/jobs";
import { Session } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/utils";
import { isSharedWithOrganization } from "@/lib/helpers/job";
import { getJobQueryKey, getQueryClient } from "@/queries";

interface JobDetailsPageParams {
  agentId: string;
  jobId: string;
}

async function checkJobAccess(
  job: JobWithSokosumiStatus,
  session: Session,
): Promise<boolean> {
  // Check if user owns the job AND it belongs to current scope
  if (job.userId === session.user.id) {
    // Job must belong to the same scope (matching organizationId)
    if (job.organizationId === session.session.activeOrganizationId) {
      return true;
    }
    // If we reach here: user owns job but it's in different scope
    return false;
  }

  // Check if job is shared with user's active organization
  if (
    session.session.activeOrganizationId &&
    isSharedWithOrganization(job, session.session.activeOrganizationId)
  ) {
    return true;
  }

  return false;
}

export default async function JobDetailsPage({
  params,
}: {
  params: Promise<JobDetailsPageParams>;
}) {
  const session = await getSession();
  if (!session) {
    return notFound();
  }
  const { agentId, jobId } = await params;

  const agent = await agentRepository.getAgentWithRelationsById(agentId);
  if (!agent) {
    notFound();
  }

  const job = await jobRepository.getJobById(jobId);
  if (!job) {
    console.warn("job not found in job detail page");
    notFound();
  }
  if (job.agent.id !== agentId) {
    console.warn("job not found in job detail page");
    notFound();
  }

  // set the Job in the query client
  const queryClient = getQueryClient();
  queryClient.setQueryData(getJobQueryKey(jobId), job);

  // Check if user can access this job (either owns it or it's shared with their organization)
  const canAccessJob = await checkJobAccess(job, session);
  if (!canAccessJob) {
    redirect(`/agents/${agentId}/jobs`);
  }

  // Determine if the job should be read-only (user is not the owner)
  const readOnly = job.userId !== session.user.id;

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <JobDetails
        job={job}
        readOnly={readOnly}
        activeOrganizationId={session.session.activeOrganizationId}
      />
    </HydrationBoundary>
  );
}
