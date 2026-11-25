import "server-only";

import { FINISHED_STATUSES } from "@/app/tasks/utils/task-due";
import { taskHref } from "@/app/tasks/utils/task-href";
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
  rows: TimelineRow[];
  /** More open Tasks were due than the Timeline read. */
  truncated: boolean;
}

/**
 * The workspace's open projects, pinned first, with the open Tasks the
 * reader can see that are due by the end of the Timeline's last week. Core
 * applies the reader's Task access, so private Tasks stay private.
 */
export async function loadProjectsTimeline(
  today: string,
): Promise<ProjectsTimelineData> {
  const [{ projects }, { tasks, truncated }] = await Promise.all([
    projectService.listProjects({
      limit: TIMELINE_PAGE_LIMIT,
      state: "open",
      pinnedFirst: true,
    }),
    loadDueTasks(timelineLastDay(today)),
  ]);
  return {
    rows: buildTimeline(
      projects.map(({ id, name }) => ({ id, name })),
      today,
      tasks,
    ),
    truncated,
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
  return { tasks, truncated: cursor !== null };
}
