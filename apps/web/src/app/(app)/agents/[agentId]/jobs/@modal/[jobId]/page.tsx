import { JobDetailsLoader } from "@/app/agents/[agentId]/jobs/_lib/job-details-loader";
import { JobDetailsModal } from "@/app/agents/[agentId]/jobs/components/job-details-modal";

export default async function JobDetailsModalPage({
  params,
}: {
  params: Promise<{ agentId: string; jobId: string }>;
}) {
  const { agentId, jobId } = await params;
  return (
    <JobDetailsLoader agentId={agentId} jobId={jobId}>
      {(props) => <JobDetailsModal agentId={agentId} {...props} />}
    </JobDetailsLoader>
  );
}
