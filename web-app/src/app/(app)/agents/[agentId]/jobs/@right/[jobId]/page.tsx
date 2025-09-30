import { notFound } from "next/navigation";

import { JobDetails } from "@/components/jobs";
import { getSession } from "@/lib/auth/utils";
import { isSharedWithOrganization, JobWithStatus } from "@/lib/db";
import { agentRepository, jobRepository } from "@/lib/db/repositories";
import { userService } from "@/lib/services";

interface JobDetailsPageParams {
  agentId: string;
  jobId: string;
}

async function checkJobAccess(
  job: JobWithStatus,
  userId: string,
): Promise<boolean> {
  // User owns the job
  if (job.userId === userId) {
    return true;
  }

  // Check if job is shared with user's organization
  try {
    const activeOrganization = await userService.getActiveOrganization();
    if (
      activeOrganization &&
      isSharedWithOrganization(job, activeOrganization.id)
    ) {
      return true;
    }
  } catch (error) {
    console.error("Error checking organization access:", error);
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

  // Check if user can access this job (either owns it or it's shared with their organization)
  const canAccessJob = await checkJobAccess(job, session.user.id);
  if (!canAccessJob) {
    notFound();
  }

  // Determine if the job should be read-only (user is not the owner)
  const readOnly = job.userId !== session.user.id;

  // Fetch active organization ID to pass to JobDetails
  const activeOrganizationId = await userService.getActiveOrganizationId();

  return (
    <JobDetails
      job={job}
      readOnly={readOnly}
      activeOrganizationId={activeOrganizationId}
    />
  );
}
