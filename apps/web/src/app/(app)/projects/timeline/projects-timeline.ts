import { dueDayDate, shiftDay } from "@/app/tasks/utils/task-due";

/** How many weeks the Timeline shows, this week first. */
export const TIMELINE_WEEK_COUNT = 8;

export interface TimelineTask {
  id: string;
  name: string;
  href: string;
  projectId: string | null;
  /** `YYYY-MM-DD`. */
  dueOn: string;
}

export interface TimelineProject {
  id: string;
  name: string;
}

export interface TimelineRow {
  project: TimelineProject;
  overdue: TimelineTask[];
  /** One list per week of `timelineWeeks`, earliest due first. */
  weeks: TimelineTask[][];
  hasDueTasks: boolean;
}

/** The Monday of each Timeline week, as `YYYY-MM-DD`, starting with `today`'s week. */
export function timelineWeeks(today: string): string[] {
  const monday = shiftDay(today, -((dueDayDate(today).getUTCDay() + 6) % 7));
  return Array.from({ length: TIMELINE_WEEK_COUNT }, (_, week) =>
    shiftDay(monday, week * 7),
  );
}

/** The last day the Timeline shows: the Sunday of its last week. */
export function timelineLastDay(today: string): string {
  return shiftDay(timelineWeeks(today).at(-1) ?? today, 6);
}

/**
 * One row per project, in the order given. Open work due before `today` is
 * overdue; the rest falls in its week. Tasks of other projects, without a
 * project, or past the last week are left out.
 */
export function buildTimeline(
  projects: TimelineProject[],
  today: string,
  tasks: TimelineTask[],
): TimelineRow[] {
  const weeks = timelineWeeks(today);
  const lastDay = timelineLastDay(today);
  const rows = new Map<string, TimelineRow>(
    projects.map((project) => [
      project.id,
      {
        project,
        overdue: [],
        weeks: weeks.map(() => []),
        hasDueTasks: false,
      },
    ]),
  );

  for (const task of tasks) {
    const row = task.projectId ? rows.get(task.projectId) : undefined;
    if (!row || task.dueOn > lastDay) continue;
    if (task.dueOn < today) {
      row.overdue.push(task);
    } else {
      // The last week whose Monday is on or before the due day.
      const week = weeks.findLastIndex((monday) => monday <= task.dueOn);
      row.weeks[week]?.push(task);
    }
    row.hasDueTasks = true;
  }

  return [...rows.values()];
}
