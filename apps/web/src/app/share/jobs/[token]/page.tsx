import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { JobDetails } from "@/components/jobs";
import { siteConfig } from "@/config/site";
import { getAgentName, getAgentResolvedImage } from "@/lib/helpers/agent";
import { jobService } from "@/lib/services";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const t = await getTranslations("Share.Jobs.Metadata");

  const { token } = await params;
  const result = await jobService.getPubliclySharedJob(token);
  if (!result) {
    return notFound();
  }

  const { job, share } = result;
  const agentImage = getAgentResolvedImage(job.agent);
  const userName = job.user.name;
  const jobName = job.name ?? t("defaultName");

  if (!share.allowSearchIndexing) {
    return {
      robots: {
        index: false,
        follow: false,
        googleBot: {
          index: false,
          follow: false,
        },
      },
    };
  }

  return {
    title: t("title", { name: jobName }),
    description: t("description"),
    openGraph: {
      title: t("title", { name: jobName }),
      description: t("description"),
      type: "article",
      url: `${siteConfig.url}/share/jobs/${token}`,
      authors: [userName],
      images: agentImage
        ? [
            {
              url: agentImage,
              width: 400,
              height: 250,
              alt: jobName,
            },
          ]
        : [],
    },
  };
}

export default async function JobPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const result = await jobService.getPubliclySharedJob(token);
  if (!result) {
    return notFound();
  }

  const { job } = result;
  const agentName = getAgentName(job.agent);

  return (
    <div className="container mx-auto flex justify-center p-4 md:p-8">
      <div className="w-full space-y-4">
        <h1 className="text-2xl font-light">{agentName}</h1>
        <JobDetails job={job} className="w-full" readOnly />
      </div>
    </div>
  );
}
