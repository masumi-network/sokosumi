import { notFound, redirect } from "next/navigation";

import { JobDetails } from "@/app/agents/[agentId]/jobs/@right/components/job-details";
import { UnAuthorizedError } from "@/lib/auth/errors";
import { getSessionUser } from "@/lib/auth/utils";
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
  try {
    const sessionUser = await getSessionUser();
    if (job.userId !== sessionUser.id) {
      console.warn("job not found in job detail page");
      notFound();
    }
  } catch (error) {
    if (error instanceof UnAuthorizedError) {
      redirect("/login");
    }
    throw error;
  }

  return <JobDetails job={job} />;
}
