import { notFound } from "next/navigation";

import { JobDetails } from "@/components/jobs";
import { jobService } from "@/lib/services";

export default async function JobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;

  const job = await jobService.getSharedJob(jobId);
  if (!job) {
    return notFound();
  }

  return (
    <div className="container mx-auto p-4 md:p-8">
      <JobDetails job={job} readOnly />
    </div>
  );
}
