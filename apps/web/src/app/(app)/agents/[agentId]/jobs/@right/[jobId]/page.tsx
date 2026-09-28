import { JobDetailsView } from "@/app/agents/[agentId]/jobs/_lib/job-details-view";
import JobDetails from "@/components/jobs/job-details/job-details";

export default async function JobDetailsPage({
  params,
}: {
  params: Promise<{ agentId: string; jobId: string }>;
}) {
  const { agentId, jobId } = await params;
  return (
    <JobDetailsView agentId={agentId} jobId={jobId}>
      {(props) => <JobDetails className="h-full" {...props} />}
    </JobDetailsView>
  );
}
