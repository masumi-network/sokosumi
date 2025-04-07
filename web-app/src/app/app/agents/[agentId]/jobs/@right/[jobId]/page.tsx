import { notFound } from "next/navigation";

import { JobDetails } from "@/app/agents/[agentId]/jobs/@right/components/job-details";
import { requireAuthentication } from "@/lib/auth/utils";
import { getAgentById } from "@/lib/db/services/agent.service";
import { getJobById } from "@/lib/db/services/job.service";

interface JobPageParams {
  agentId: string;
  jobId: string;
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<JobPageParams>;
}) {
  const { agentId, jobId } = await params;

  const agent = await getAgentById(agentId);
  if (!agent) {
    console.log("agent not found in job detail page");
    notFound();
  }

  const job = await getJobById(jobId);
  if (!job) {
    console.log("job not found in job detail page");
    notFound();
  }
  if (job.agent.id !== agentId) {
    console.log("job not found in job detail page");
    notFound();
  }
  const { session } = await requireAuthentication();
  if (job.userId !== session.user.id) {
    console.log("job not found in job detail page");
    notFound();
  }

  return <JobDetails job={job} />;
}
