import { notFound } from "next/navigation";

import { JobDetails } from "@/components/job/job-details";
import { requireAuthentication } from "@/lib/auth/utils";
import { getJobById } from "@/lib/db/services/job.service";

interface JobPageParams {
  jobId: string;
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<JobPageParams>;
}) {
  const { jobId } = await params;

  const job = await getJobById(jobId);
  if (!job) {
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
