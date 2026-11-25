import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getFormatter, getTimeZone, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import {
  DUE_DAY_FORMAT,
  dayInTimeZone,
  dueDayDate,
} from "@/app/tasks/utils/task-due";
import { Button } from "@/components/ui/button";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { type TimelineTask, timelineWeeks } from "./projects-timeline";
import { loadProjectsTimeline } from "./projects-timeline-data";

/** Tasks a cell lists before it links to the rest. */
const CELL_TASK_LIMIT = 3;

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
  const more = tasks.length - CELL_TASK_LIMIT;
  return (
    <td className="bg-background border-border rounded-lg border p-1 align-top">
      <ul className="flex flex-col gap-0.5">
        {tasks.slice(0, CELL_TASK_LIMIT).map((task) => (
          <li key={task.id}>
            <Link
              href={task.href}
              title={task.name}
              className={cn(
                "hover:bg-accent block min-h-6 truncate rounded-md px-1.5 py-0.5",
                overdue && "text-destructive",
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
              href={`/tasks?projectId=${projectId}`}
              className="text-muted-foreground hover:bg-accent block min-h-6 rounded-md px-1.5 py-0.5"
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
  await connection();
  const [t, format, timeZone] = await Promise.all([
    getTranslations("App.Projects.Timeline"),
    getFormatter(),
    getTimeZone(),
  ]);
  const today = dayInTimeZone(new Date(), timeZone);
  const weeks = timelineWeeks(today);
  const { rows, truncated } = await loadProjectsTimeline(today);
  const formatDay = (day: string) =>
    format.dateTime(dueDayDate(day), DUE_DAY_FORMAT);
  const cellLabels = {
    dueLabel: (dueOn: string) => t("due", { date: formatDay(dueOn) }),
    moreLabel: (count: number) => t("more", { count }),
  };

  return (
    <div className="flex w-full flex-col gap-4 pb-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button asChild variant="ghost" className="-ms-2 gap-1.5">
          <Link href="/projects">
            <ArrowLeft className="size-4" aria-hidden />
            {t("back")}
          </Link>
        </Button>
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
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[64rem] table-fixed border-separate border-spacing-1 text-sm">
              <caption className="sr-only">{t("caption")}</caption>
              <thead>
                <tr className="text-muted-foreground text-start text-xs">
                  <th
                    scope="col"
                    className="bg-card-background sticky start-0 z-10 w-40 px-1.5 py-1 text-start font-medium"
                  >
                    {t("project")}
                  </th>
                  <th
                    scope="col"
                    className="px-1.5 py-1 text-start font-medium"
                  >
                    {t("overdue")}
                  </th>
                  {weeks.map((monday, index) => (
                    <th
                      key={monday}
                      scope="col"
                      className="px-1.5 py-1 text-start font-medium tabular-nums"
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
                      className="bg-card-background sticky start-0 z-10 p-0 text-start align-top font-medium"
                    >
                      <Link
                        href={`/projects/${row.project.id}`}
                        title={row.project.name}
                        className="hover:bg-accent block min-h-6 truncate rounded-md px-1.5 py-1"
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
                        className="text-muted-foreground px-1.5 py-1 align-top"
                      >
                        {t("noDueDates")}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {truncated ? (
        <p className="text-muted-foreground text-sm">{t("truncated")}</p>
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
