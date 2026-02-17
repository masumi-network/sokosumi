import { HydrationBoundary } from "@tanstack/react-query";

import { loadJobDetails } from "@/app/agents/[agentId]/jobs/_lib/load-job-details";
import { JobDetails } from "@/components/jobs";

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
  const { activeOrganizationId, dehydratedState, job, readOnly } =
    await loadJobDetails({ agentId, jobId });

  return (
    <HydrationBoundary state={dehydratedState}>
      <JobDetails
        className="h-full"
        job={job}
        readOnly={readOnly}
        activeOrganizationId={activeOrganizationId}
      />
    </HydrationBoundary>
  );
}
