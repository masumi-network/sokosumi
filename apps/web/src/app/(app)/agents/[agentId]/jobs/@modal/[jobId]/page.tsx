import { JobDetailsView } from "@/app/agents/[agentId]/jobs/_lib/job-details-view";
import { JobDetailsModal } from "@/app/agents/[agentId]/jobs/components/job-details-modal";

export default async function JobDetailsModalPage({
  params,
}: {
  params: Promise<{ agentId: string; jobId: string }>;
}) {
  const { agentId, jobId } = await params;
  return (
    <JobDetailsView agentId={agentId} jobId={jobId}>
      {(props) => <JobDetailsModal agentId={agentId} {...props} />}
    </JobDetailsView>
  );
}
