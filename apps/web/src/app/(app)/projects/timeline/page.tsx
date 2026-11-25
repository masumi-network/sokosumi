import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTimeZone, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { DUE_DAY_FORMAT, dueDayDate } from "@/app/tasks/utils/task-due";
import { BackLink } from "@/components/back-link";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { type TimelineTask, timelineWeeks } from "./projects-timeline";
import { loadProjectsTimeline } from "./projects-timeline-data";

/** Tasks a cell lists before it links to the rest. */
const CELL_TASK_LIMIT = 3;

const CAPTION_ID = "projects-timeline-caption";

/**
 * Every cell's text starts where a card's does: 1px in (the card's border,
 * `p-px` elsewhere), then this 1px border, transparent, and its padding.
 */
const CELL_TEXT_CLASS =
  "block min-h-6 rounded-md border border-transparent px-1.5 py-0.5";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Projects.Timeline");
  return { title: t("title") };
}

/** One project's Tasks for one week, or its overdue ones. */
function TimelineCell({
  tasks,
  projectId,
  dueLabel,
  moreLabel,
  overdue = false,
}: {
  tasks: TimelineTask[];
  projectId: string;
  /** Screen-reader text after a Task's name: when it is due. */
  dueLabel: (dueOn: string) => string;
  moreLabel: (count: number) => string;
  overdue?: boolean;
}) {
  // An empty week is bare panel: cards are for work, not for slots.
  if (tasks.length === 0) return <td className="p-1" />;
  const more = tasks.length - CELL_TASK_LIMIT;
  return (
    <td className="bg-background border-border rounded-lg border p-0 align-top">
      <ul className="flex flex-col gap-0.5">
        {tasks.slice(0, CELL_TASK_LIMIT).map((task) => (
          <li key={task.id}>
            <Link
              href={task.href}
              className={cn(
                CELL_TEXT_CLASS,
                "hover:bg-accent break-words",
                // As the due badge marks overdue work: weight, not red.
                overdue && "font-medium",
              )}
            >
              {task.name}
              <span className="sr-only">{dueLabel(task.dueOn)}</span>
            </Link>
          </li>
        ))}
        {more > 0 ? (
          <li>
            <Link
              href={`/tasks?projectId=${projectId}&sort=dueOn`}
              className={cn(
                CELL_TEXT_CLASS,
                "text-muted-foreground hover:bg-accent",
              )}
            >
              {moreLabel(more)}
            </Link>
          </li>
        ) : null}
      </ul>
    </td>
  );
}

function TimelineSkeleton() {
  return (
    <div className="flex w-full flex-col gap-4 pb-6" aria-busy>
      <Skeleton className="h-9 w-full max-w-72" />
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  );
}

/**
 * Every open project's due work on one week axis: what lands when, across
 * projects. Only Tasks with a due date show, so the page says so.
 */
export async function ProjectsTimelineContent() {
  const [t, format, timeZone] = await Promise.all([
    getTranslations("App.Projects.Timeline"),
    getFormatter(),
    getTimeZone(),
  ]);
  const { today, rows, tasksCut, projectsCut } =
    await loadProjectsTimeline(timeZone);
  const weeks = timelineWeeks(today);
  const formatDay = (day: string) =>
    format.dateTime(dueDayDate(day), DUE_DAY_FORMAT);
  const cellLabels = {
    dueLabel: (dueOn: string) => t("due", { date: formatDay(dueOn) }),
    moreLabel: (count: number) => t("more", { count }),
  };

  return (
    <div className="flex w-full flex-col gap-4 pb-6">
      <RefreshPrefetchedPage />
      <div className="flex flex-col items-start gap-1">
        {/* Phones go back with the header's own back, as on a Task page. */}
        <BackLink
          href="/projects"
          className="text-muted-foreground press hover:text-foreground mb-2 hidden items-center gap-1.5 text-sm transition-colors md:inline-flex"
        >
          <ArrowLeft className="size-4" aria-hidden />
          <span>{t("back")}</span>
        </BackLink>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          {t("description")}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className={cn(HOLDER_CLASS, "px-6 py-12 text-center")}>
          <h2 className="text-foreground text-base font-semibold">
            {t("empty.title")}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {t("empty.description")}
          </p>
        </div>
      ) : (
        <div className={HOLDER_CLASS}>
          {/* A keyboard stop of its own: arrows scroll it, so weeks past the
              edge are reachable even where no link would take focus. */}
          <div
            role="region"
            aria-labelledby={CAPTION_ID}
            tabIndex={0}
            className="focus-visible:ring-ring overflow-x-auto overscroll-x-contain rounded-lg outline-none focus-visible:ring-2"
          >
            <table className="w-full min-w-[64rem] table-fixed border-separate border-spacing-1 text-sm">
              <caption id={CAPTION_ID} className="sr-only">
                {t("caption")}
              </caption>
              <thead>
                <tr className="text-muted-foreground text-start text-xs">
                  <th
                    scope="col"
                    className="bg-card-background sticky start-0 z-10 w-28 px-2 py-1 text-start font-medium sm:w-40"
                  >
                    {t("project")}
                  </th>
                  <th scope="col" className="px-2 py-1 text-start font-medium">
                    {t("overdue")}
                  </th>
                  {weeks.map((monday, index) => (
                    <th
                      key={monday}
                      scope="col"
                      className="px-2 py-1 text-start font-medium tabular-nums"
                    >
                      {index === 0 ? t("thisWeek") : formatDay(monday)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.project.id}>
                    <th
                      scope="row"
                      className="bg-card-background sticky start-0 z-10 p-px text-start align-top font-medium"
                    >
                      <Link
                        href={`/projects/${row.project.id}`}
                        className={cn(
                          CELL_TEXT_CLASS,
                          "hover:bg-accent break-words",
                        )}
                      >
                        {row.project.name}
                      </Link>
                    </th>
                    {row.hasDueTasks ? (
                      <>
                        <TimelineCell
                          {...cellLabels}
                          tasks={row.overdue}
                          projectId={row.project.id}
                          overdue
                        />
                        {row.weeks.map((tasks, index) => (
                          <TimelineCell
                            {...cellLabels}
                            key={weeks[index]}
                            tasks={tasks}
                            projectId={row.project.id}
                          />
                        ))}
                      </>
                    ) : (
                      <td
                        colSpan={weeks.length + 1}
                        className="text-muted-foreground p-px align-top"
                      >
                        {/* Narrow enough to fit beside the project column
                            on a phone, and held there while the weeks
                            scroll: the column is w-28 (sm:w-40) plus the
                            table's 4px spacing on both sides. */}
                        <span
                          className={cn(
                            CELL_TEXT_CLASS,
                            "sticky start-30 max-w-48 sm:start-42 sm:max-w-none",
                          )}
                        >
                          {/* A cut read may have missed this row's Tasks. */}
                          {tasksCut ? t("notAllLoaded") : t("noDueDates")}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tasksCut ? (
        <p className="text-muted-foreground text-sm">{t("tasksCut")}</p>
      ) : null}
      {projectsCut ? (
        <p className="text-muted-foreground text-sm">{t("projectsCut")}</p>
      ) : null}
    </div>
  );
}

export default function ProjectsTimelinePage() {
  return (
    <Suspense fallback={<TimelineSkeleton />}>
      <ProjectsTimelineContent />
    </Suspense>
  );
}
