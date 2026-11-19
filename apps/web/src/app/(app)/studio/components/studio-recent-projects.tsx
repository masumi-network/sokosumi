"use client";

import type { ImageStudioRecentProjects } from "@sokosumi/core-client";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { handStudioBriefTo } from "@/app/projects/components/image-studio/studio-workspace-brief";
import { assetContentUrl } from "@/app/projects/components/image-studio/types";
import { usePageListSearch } from "@/components/page-list-search";

type Formatter = ReturnType<typeof useFormatter>;

/**
 * "Nov 11", with the year only when it is not this one. Both years are read
 * through the same formatter, so in its time zone, and against the `now` the
 * server rendered with, so the server and the browser agree.
 */
export function recentProjectDate(
  format: Formatter,
  latestAt: Date,
  now: Date,
): string {
  const year = (date: Date) => format.dateTime(date, { year: "numeric" });
  return format.dateTime(latestAt, {
    month: "short",
    day: "numeric",
    ...(year(latestAt) === year(now) ? {} : { year: "numeric" }),
  });
}

/**
 * All projects, for a workspace that already makes ads: the projects with the
 * newest Studio images, each one link into that project's gallery. A plain
 * link is enough to switch scope: the scope hook remembers a `?projectId=`
 * it lands on. A same-tab click takes the typed brief along, as Select
 * project does; a new tab or window leaves it where it is.
 */
export function StudioRecentProjects({
  now,
  projects,
}: {
  /** The server's render time. */
  now: Date;
  projects: ImageStudioRecentProjects["projects"];
}) {
  const t = useTranslations("App.Studio.RecentProjects");
  const visibleProjects = usePageListSearch(projects, (project) => ({
    primary: [project.projectName, project.projectId],
  }));
  const format = useFormatter();
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
        {visibleProjects.map((project) => (
          <li key={project.projectId}>
            <Link
              className="bg-card-background border-border hover:bg-card-background-hover focus-visible:ring-ring flex items-center gap-3 rounded-xl border p-2 transition-colors outline-none focus-visible:ring-2 sm:flex-col sm:items-stretch"
              href={`/studio?projectId=${encodeURIComponent(project.projectId)}`}
              onClick={(event) => {
                const newTab =
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey;
                if (!newTab) handStudioBriefTo(project.projectId);
              }}
            >
              <RecentProjectThumb
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
                    {recentProjectDate(format, new Date(project.latestAt), now)}
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

const THUMB_CLASS =
  "bg-muted size-16 shrink-0 rounded-lg object-cover sm:aspect-[4/3] sm:size-auto sm:w-full";

/**
 * The newest image, or the same muted tile when its bytes cannot be read, so
 * a missing file never shows the browser's broken-image mark. The ref catches
 * an image that failed before hydration, when `onError` was not listening yet.
 */
function RecentProjectThumb({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span aria-hidden className={THUMB_CLASS} />;
  return (
    <img
      alt=""
      className={THUMB_CLASS}
      onError={() => setFailed(true)}
      ref={(image) => {
        if (image?.complete && image.naturalWidth === 0) setFailed(true);
      }}
      src={src}
    />
  );
}
