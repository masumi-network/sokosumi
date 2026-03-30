import { SokosumiJobStatus, TaskEventOrigin } from "@sokosumi/database";
import { ArrowUpRight, Clock3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { ExpandableMarkdown } from "@/components/expandable-markdown";
import { JobDetailsView } from "@/components/jobs";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { siteConfig } from "@/config/site";
import { getAgentName, getAgentResolvedImage } from "@/lib/helpers/agent";
import { shareService } from "@/lib/services";
import { getInitials } from "@/lib/utils/text";

function formatDate(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getOriginTranslationKey(origin: TaskEventOrigin) {
  return origin.toLowerCase();
}

function getLinkedJobStatus(status: string): SokosumiJobStatus {
  return status as SokosumiJobStatus;
}

async function getPublicShare(token: string) {
  return await shareService.getPubliclySharedResource(token);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const [tJobs, tTasks] = await Promise.all([
    getTranslations("Share.Jobs.Metadata"),
    getTranslations("Share.Tasks.Metadata"),
  ]);

  const { token } = await params;
  const resource = await getPublicShare(token);
  if (!resource) {
    return notFound();
  }

  if (!resource.share.allowSearchIndexing) {
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

  if (resource.kind === "job") {
    const agentImage = getAgentResolvedImage(resource.job.agent);
    const userName = resource.job.user.name;
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
      images: resource.task.coworker?.image
        ? [
            {
              url: resource.task.coworker.image,
              width: 400,
              height: 250,
              alt: resource.task.coworker.name,
            },
          ]
        : [],
    },
  };
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [locale, tTaskDetail, tTaskShare] = await Promise.all([
    getLocale(),
    getTranslations("App.Tasks.Detail"),
    getTranslations("Share.Tasks.Page"),
  ]);
  const { token } = await params;
  const resource = await getPublicShare(token);
  if (!resource) {
    return notFound();
  }

  if (resource.kind === "job") {
    const agentName = getAgentName(resource.job.agent);

    return (
      <div className="container mx-auto flex justify-center p-4 md:p-8">
        <div className="w-full space-y-4">
          <h1 className="text-2xl font-light">{agentName}</h1>
          <JobDetailsView job={resource.job} className="w-full" readOnly />
        </div>
      </div>
    );
  }

  const { task } = resource;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-10 md:px-8">
      <div className="space-y-8">
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground text-xs font-medium tracking-[0.24em] uppercase">
              {tTaskShare("eyebrow")}
            </span>
            <TaskStatusBadge status={task.status} />
          </div>
          <h1 className="max-w-3xl text-3xl font-light tracking-tight md:text-4xl">
            {task.name}
          </h1>
          {task.description ? (
            <ExpandableMarkdown
              content={task.description}
              className="prose prose-sm max-w-none"
              expandLabel={tTaskDetail("expand")}
              collapseLabel={tTaskDetail("collapse")}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              {tTaskShare("descriptionEmpty")}
            </p>
          )}
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-6">
            <div className="rounded-2xl border p-5">
              <h2 className="text-muted-foreground mb-4 text-xs font-medium tracking-[0.24em] uppercase">
                {tTaskDetail("jobs")}
              </h2>
              {task.jobs.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {tTaskShare("jobsEmpty")}
                </p>
              ) : (
                <ul className="space-y-3">
                  {task.jobs.map((job) => (
                    <li key={job.id} className="rounded-xl border p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <p className="text-sm font-medium">
                            {job.name?.trim() || tTaskDetail("jobsUntitled")}
                          </p>
                          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
                            <span>{job.agentName}</span>
                            <span>
                              {tTaskShare("jobCreatedAt", {
                                date: formatDate(job.createdAt, locale),
                              })}
                            </span>
                            {job.completedAt ? (
                              <span>
                                {tTaskShare("jobCompletedAt", {
                                  date: formatDate(job.completedAt, locale),
                                })}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <JobStatusBadge
                            status={getLinkedJobStatus(job.status)}
                          />
                          {job.shareToken ? (
                            <Link
                              href={`/share/${job.shareToken}`}
                              className="text-sm underline-offset-4 hover:underline"
                            >
                              <span className="inline-flex items-center gap-1">
                                {tTaskShare("publicJobLink")}
                                <ArrowUpRight className="size-3" />
                              </span>
                            </Link>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              {tTaskShare("privateJobLink")}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border p-5">
              <h2 className="text-muted-foreground mb-4 text-xs font-medium tracking-[0.24em] uppercase">
                {tTaskShare("milestonesTitle")}
              </h2>
              {task.events.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {tTaskShare("milestonesEmpty")}
                </p>
              ) : (
                <ul className="space-y-3">
                  {task.events.map((event) => (
                    <li
                      key={event.id}
                      className="flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-2">
                        <TaskStatusBadge status={event.status} />
                        <p className="text-muted-foreground text-sm">
                          {tTaskDetail(
                            `originApp.${getOriginTranslationKey(event.origin)}`,
                          )}
                        </p>
                        {event.credits != null ? (
                          <p className="text-muted-foreground text-xs">
                            {tTaskShare("chargedCredits", {
                              credits: event.credits,
                            })}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground inline-flex items-center gap-2 text-xs">
                        <Clock3 className="size-3" />
                        {formatDate(event.createdAt, locale)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <aside className="rounded-2xl border p-5">
            <h2 className="text-muted-foreground mb-4 text-xs font-medium tracking-[0.24em] uppercase">
              {tTaskDetail("properties")}
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground text-sm">
                  {tTaskDetail("status")}
                </span>
                <TaskStatusBadge status={task.status} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground text-sm">
                  {tTaskDetail("coworker")}
                </span>
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar className="size-6">
                    {task.coworker?.image ? (
                      <AvatarImage
                        src={task.coworker.image}
                        alt={task.coworker.name}
                      />
                    ) : null}
                    <AvatarFallback className="text-[10px]">
                      {getInitials(task.coworker?.name ?? "C")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate text-sm">
                    {task.coworker?.name ?? "—"}
                  </span>
                </div>
              </div>
              <div className="border-border/50 border-t pt-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground text-sm">
                    {tTaskDetail("created")}
                  </span>
                  <span className="text-sm">
                    {formatDate(task.createdAt, locale)}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground text-sm">
                  {tTaskDetail("updated")}
                </span>
                <span className="text-sm">
                  {formatDate(task.updatedAt, locale)}
                </span>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
