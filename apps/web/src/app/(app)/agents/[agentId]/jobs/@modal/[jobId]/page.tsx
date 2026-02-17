import { HydrationBoundary } from "@tanstack/react-query";

import { loadJobDetails } from "@/app/agents/[agentId]/jobs/_lib/load-job-details";
import { JobDetailsModal } from "@/app/agents/[agentId]/jobs/components/job-details-modal";

interface JobDetailsModalPageParams {
  agentId: string;
  jobId: string;
}

export default async function JobDetailsModalPage({
  params,
}: {
  params: Promise<JobDetailsModalPageParams>;
}) {
  const { agentId, jobId } = await params;
  const { activeOrganizationId, dehydratedState, job, readOnly } =
    await loadJobDetails({ agentId, jobId });

  return (
    <HydrationBoundary state={dehydratedState}>
      <JobDetailsModal
        activeOrganizationId={activeOrganizationId}
        agentId={agentId}
        job={job}
        readOnly={readOnly}
      />
    </HydrationBoundary>
  );
}
