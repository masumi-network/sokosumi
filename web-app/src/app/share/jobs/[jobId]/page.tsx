import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { JobDetails } from "@/components/jobs";
import { siteConfig } from "@/config/site";
import { getAgentResolvedImage } from "@/lib/db";
import { jobService } from "@/lib/services";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ jobId: string }>;
}): Promise<Metadata> {
  const t = await getTranslations("Share.Jobs.Metadata");

  const { jobId } = await params;
  const job = await jobService.getPubliclySharedJob(jobId);
  if (!job) {
    return notFound();
  }
  const agentImage = getAgentResolvedImage(job.agent);
  const userName = job.user.name;
  const jobName = job.name ?? t("defaultName");

  return {
    title: t("title", { name: jobName }),
    description: t("description"),
    openGraph: {
      title: t("title", { name: jobName }),
      description: t("description"),
      type: "article",
      url: `${siteConfig.url}/share/jobs/${jobId}`,
      authors: [userName],
      images: [
        {
          url: agentImage,
          width: 400,
          height: 250,
          alt: jobName,
        },
      ],
    },
  };
}

export default async function JobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;

  const job = await jobService.getPubliclySharedJob(jobId);
  if (!job) {
    return notFound();
  }

  return (
    <div className="justify-content container mx-auto flex items-center p-4 md:p-8">
      <JobDetails job={job} readOnly />
    </div>
  );
}
