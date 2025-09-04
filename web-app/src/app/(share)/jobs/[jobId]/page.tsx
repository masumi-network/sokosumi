import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { JobDetails } from "@/components/jobs";
import { jobService } from "@/lib/services";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ jobId: string }>;
}): Promise<Metadata> {
  const t = await getTranslations("Share.Jobs.Metadata");

  const { jobId } = await params;
  const job = await jobService.getSharedJob(jobId);
  if (!job) {
    return notFound();
  }

  return {
    title: job.name ? t("title", { name: job.name }) : t("defaultTitle"),
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
    <div className="justify-content container mx-auto flex items-center p-4 md:p-8">
      <JobDetails job={job} readOnly />
    </div>
  );
}
