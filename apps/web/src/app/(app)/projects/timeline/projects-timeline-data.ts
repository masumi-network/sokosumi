import "server-only";

import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";

import { dayInTimeZone, FINISHED_STATUSES } from "@/app/tasks/utils/task-due";
import { taskHref } from "@/app/tasks/utils/task-href";
import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { projectService } from "@/lib/services/project.service";
import { taskService } from "@/lib/services/task.service";
import { TASK_STATUS_DISPLAY_ORDER } from "@/lib/utils/task-status-order";

import {
  buildTimeline,
  type TimelineRow,
  type TimelineTask,
  timelineLastDay,
} from "./projects-timeline";

/** Core's page cap; the Timeline reads at most `TIMELINE_MAX_PAGES` of them. */
const TIMELINE_PAGE_LIMIT = 100;
const TIMELINE_MAX_PAGES = 5;

/** Work a due date still presses on. */
const OPEN_STATUSES = TASK_STATUS_DISPLAY_ORDER.filter(
  (status) => !FINISHED_STATUSES.includes(status),
);

export interface ProjectsTimelineData {
  /** The reader's day, `YYYY-MM-DD`, the weeks count from. */
  today: string;
  rows: TimelineRow[];
  /**
   * More open Tasks were due than the Timeline read. The read is the whole
   * workspace's, earliest first, so a row may then miss Tasks it has.
   */
  tasksCut: boolean;
  /** More open projects exist than the Timeline lists. */
  projectsCut: boolean;
}

/**
 * The workspace's open projects, pinned first, with the open Tasks the
 * reader can see that are due by the end of the Timeline's last week. Core
 * applies the reader's Task access, so private Tasks stay private.
 */
async function readProjectsTimeline(
  timeZone: string,
): Promise<ProjectsTimelineData> {
  const today = dayInTimeZone(new Date(), timeZone);
  const [projectsPage, { tasks, tasksCut }] = await Promise.all([
    projectService.listProjects({
      limit: TIMELINE_PAGE_LIMIT,
      state: "open",
      pinnedFirst: true,
    }),
    loadDueTasks(timelineLastDay(today)),
  ]);
  return {
    today,
    rows: buildTimeline(
      projectsPage.projects.map(({ id, name }) => ({ id, name })),
      today,
      tasks,
    ),
    tasksCut,
    projectsCut: Boolean(projectsPage.pagination?.nextCursor),
  };
}

/** Open Tasks due on or before `dueOnTo`, earliest first, page by page. */
async function loadDueTasks(dueOnTo: string) {
  const tasks: TimelineTask[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await taskService.listTasks({
      scope: "workspace",
      sort: "dueOn",
      dueOnTo,
      status: OPEN_STATUSES,
      limit: TIMELINE_PAGE_LIMIT,
      cursor,
    });
    for (const task of page.tasks) {
      if (!task.dueOn) continue;
      tasks.push({
        id: task.id,
        name: task.name,
        href: taskHref(task),
        projectId: task.projectId,
        dueOn: task.dueOn,
      });
    }
    cursor = page.pagination?.nextCursor ?? null;
    pages += 1;
  } while (cursor && pages < TIMELINE_MAX_PAGES);
  return { tasks, tasksCut: cursor !== null };
}

async function readPrivateCachedProjectsTimeline(
  timeZone: string,
): Promise<ProjectsTimelineData> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  return readProjectsTimeline(timeZone);
}

/**
 * The Timeline's Core reads, cached for the browser only, so a link prefetch
 * carries the page. A failed read is never kept: the page then renders fresh
 * on the click, with the same reads uncached. "Today" can be one stale
 * window old, as on the Calendar.
 */
export function loadProjectsTimeline(
  timeZone: string,
): Promise<ProjectsTimelineData> {
  return readPrivateCachedProjectsTimeline(timeZone).catch(
    async (error: unknown) => {
      unstable_rethrow(error);
      await connection();
      return readProjectsTimeline(timeZone);
    },
  );
}
