import { notFound } from "next/navigation";

import { JobDetails } from "@/app/agents/[agentId]/jobs/@right/components/job-details";
import { getSessionOrThrow } from "@/lib/auth/utils";
import { getAgentById, getJobById } from "@/lib/db";

interface JobDetailsPageParams {
  agentId: string;
  jobId: string;
}

export default async function JobDetailsPage({
  params,
}: {
  params: Promise<JobDetailsPageParams>;
}) {
  const session = await getSessionOrThrow();
  const { agentId, jobId } = await params;

  const agent = await getAgentById(agentId);
  if (!agent) {
    console.warn("agent not found in job detail page");
    notFound();
  }

  const job = await getJobById(jobId);
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
