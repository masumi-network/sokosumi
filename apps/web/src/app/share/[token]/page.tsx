import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import JobDetailsView from "@/components/jobs/job-details/job-details-view";
import { siteConfig } from "@/config/site";
import { getAgentResolvedImage } from "@/lib/helpers/agent";
import { shareService } from "@/lib/services";
import { SharedTaskView } from "../components/shared-task-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  // Start translations and token resolution immediately so metadata does not
  // waterfall: translations ∥ (params → shared resource).
  const translationsPromise = Promise.all([
    getTranslations("Share.Jobs.Metadata"),
    getTranslations("Share.Tasks.Metadata"),
  ]);
  const { token } = await params;
  const resourcePromise = shareService.getPubliclySharedResource(token);

  const [[tJobs, tTasks], resource] = await Promise.all([
    translationsPromise,
    resourcePromise,
  ]);

  if (!resource) {
    return notFound();
  }

  const disallowIndexing = !resource.share.allowSearchIndexing;
  const robotsMetadata: Pick<Metadata, "robots"> | undefined = disallowIndexing
    ? {
        robots: {
          index: false,
          follow: false,
          googleBot: {
            index: false,
            follow: false,
          },
        },
      }
    : undefined;

  if (resource.kind === "job") {
    const agentImage = getAgentResolvedImage(resource.job.agent);
    const userName = resource.job.owner.name;
    const jobName = resource.job.name ?? tJobs("defaultName");

    return {
      title: tJobs("title", { name: jobName }),
      description: tJobs("description"),
      openGraph: {
        title: tJobs("title", { name: jobName }),
        description: tJobs("description"),
        type: "article",
        url: `${siteConfig.url}/share/${token}`,
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
      ...robotsMetadata,
    };
  }

  return {
    title: tTasks("title", { name: resource.task.name }),
    description: tTasks("description"),
    openGraph: {
      title: tTasks("title", { name: resource.task.name }),
      description: tTasks("description"),
      type: "article",
      url: `${siteConfig.url}/share/${token}`,
      images: resource.task.assignee?.image
        ? [
            {
              url: resource.task.assignee.image,
              width: 400,
              height: 250,
              alt: resource.task.assignee.name,
            },
          ]
        : [],
    },
    ...robotsMetadata,
  };
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Deduped with generateMetadata via React cache() in shareService.
  const resource = await shareService.getPubliclySharedResource(token);
  if (!resource) {
    return notFound();
  }

  if (resource.kind === "job") {
    return (
      <div className="container mx-auto flex justify-center p-4 md:p-0 md:px-8">
        <JobDetailsView
          job={resource.job}
          className="w-full"
          readOnly
          publicJobLayout
        />
      </div>
    );
  }

  const { task } = resource;

  return (
    <div className="container mx-auto flex justify-center p-4 md:p-0 md:px-8">
      {await SharedTaskView({ task })}
    </div>
  );
}
