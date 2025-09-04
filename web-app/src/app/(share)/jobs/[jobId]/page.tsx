import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { JobDetails } from "@/components/jobs";
import { jobService } from "@/lib/services";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Share.Jobs.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

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
