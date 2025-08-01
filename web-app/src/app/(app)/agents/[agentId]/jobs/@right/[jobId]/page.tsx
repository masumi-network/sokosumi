import { notFound } from "next/navigation";

import { JobDetails } from "@/app/agents/[agentId]/jobs/@right/components/job-details";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { jobRepository } from "@/lib/db/repositories";
import { getAgentById } from "@/lib/services";

interface JobDetailsPageParams {
  agentId: string;
  jobId: string;
}

export default async function JobDetailsPage({
  params,
}: {
  params: Promise<JobDetailsPageParams>;
}) {
  const session = await getSessionOrRedirect();

  const { agentId, jobId } = await params;

  const agent = await getAgentById(agentId);
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

  if (job.userId !== session.user.id) {
    console.warn("job not found in job detail page");
    notFound();
  }

  return <JobDetails job={job} />;
}
