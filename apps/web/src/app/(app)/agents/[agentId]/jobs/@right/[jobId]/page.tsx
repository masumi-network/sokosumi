import { JobDetailsLoader } from "@/app/agents/[agentId]/jobs/_lib/job-details-loader";
import JobDetails from "@/components/jobs/job-details/job-details";

export default async function JobDetailsPage({
  params,
}: {
  params: Promise<{ agentId: string; jobId: string }>;
}) {
  const { agentId, jobId } = await params;
  return (
    <JobDetailsLoader agentId={agentId} jobId={jobId}>
      {(props) => <JobDetails className="h-full" {...props} />}
    </JobDetailsLoader>
  );
}
