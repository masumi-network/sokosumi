import { notFound } from "next/navigation";

import { JobDetails } from "@/app/agents/[agentId]/jobs/@right/components/job-details";
import { getSession } from "@/lib/auth/utils";
import { agentRepository, jobRepository } from "@/lib/db/repositories";

interface JobDetailsPageParams {
  agentId: string;
  jobId: string;
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

  if (job.userId !== session.user.id) {
    console.warn("job not found in job detail page");
    notFound();
  }

  return <JobDetails job={job} />;
}
