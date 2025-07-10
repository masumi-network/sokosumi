import { notFound } from "next/navigation";

import { JobDetails } from "@/app/agents/[agentId]/jobs/@right/components/job-details";
import { getSessionOrThrow } from "@/lib/auth/utils";
import { retrieveJobById } from "@/lib/db/repositories";
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
  const session = await getSessionOrThrow();
  const { agentId, jobId } = await params;

  const agent = await getAgentById(agentId);
  if (!agent) {
    notFound();
  }

  const job = await retrieveJobById(jobId);
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
