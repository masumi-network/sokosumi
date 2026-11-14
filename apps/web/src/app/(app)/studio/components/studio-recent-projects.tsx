"use client";

import type { ImageStudioRecentProjects } from "@sokosumi/core-client";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { assetContentUrl } from "@/app/projects/components/image-studio/types";

/**
 * All projects, for a workspace that already makes ads: the projects with the
 * newest Studio images, each one link into that project's gallery. A plain
 * link is enough to switch scope: the scope hook remembers a `?projectId=`
 * it lands on.
 */
export function StudioRecentProjects({
  projects,
}: {
  projects: ImageStudioRecentProjects["projects"];
}) {
  const t = useTranslations("App.Studio.RecentProjects");
  const format = useFormatter();
  const thisYear = new Date().getFullYear();
  return (
    <section
      aria-labelledby="studio-recent-projects"
      className="pointer-events-auto w-full space-y-3 text-left"
    >
      <h2
        className="text-foreground text-lg font-semibold text-balance"
        id="studio-recent-projects"
      >
        {t("title")}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {projects.map((project) => (
          <li key={project.projectId}>
            <Link
              className="bg-card-background border-border hover:bg-card-background-hover focus-visible:ring-ring flex items-center gap-3 rounded-xl border p-2 transition-colors outline-none focus-visible:ring-2 sm:flex-col sm:items-stretch"
              href={`/studio?projectId=${encodeURIComponent(project.projectId)}`}
            >
              <img
                alt=""
                className="bg-muted size-16 shrink-0 rounded-lg object-cover sm:aspect-[4/3] sm:size-auto sm:w-full"
                loading="lazy"
                src={assetContentUrl({
                  id: project.latestImageId,
                  projectId: project.projectId,
                })}
              />
              <span className="min-w-0 space-y-0.5 sm:px-1 sm:pb-1">
                <span className="block truncate text-sm font-medium">
                  {project.projectName}
                </span>
                <span className="text-muted-foreground block text-xs tabular-nums">
                  {t("imageCount", { count: project.imageCount })}
                  {" · "}
                  <time dateTime={new Date(project.latestAt).toISOString()}>
                    {format.dateTime(new Date(project.latestAt), {
                      month: "short",
                      day: "numeric",
                      // Only when it is not this year's.
                      ...(new Date(project.latestAt).getFullYear() === thisYear
                        ? {}
                        : { year: "numeric" }),
                    })}
                  </time>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
