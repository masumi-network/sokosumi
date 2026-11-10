import type { TaskStatus } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";
import { FINISHED_STATUSES } from "@/app/tasks/utils/task-due";
import { taskHref } from "@/app/tasks/utils/task-href";
import { taskService } from "@/lib/services/task.service";
import { TASK_STATUS_DISPLAY_ORDER } from "@/lib/utils/task-status-order";

import { MyDayList } from "./my-day-list.client";

export const MY_DAY_LIMIT = 5;

/** Every status a due date still presses on. */
export const MY_DAY_STATUSES = TASK_STATUS_DISPLAY_ORDER.filter(
  (status) => !FINISHED_STATUSES.includes(status),
);

/** One row of My day, as plain data the client list can append to. */
export interface MyDayRow {
  id: string;
  name: string;
  status: TaskStatus;
  /** `YYYY-MM-DD`; null never comes back from the due filter. */
  dueOn: string | null;
  href: string;
}

export interface MyDayPage {
  rows: MyDayRow[];
  /** All matching Tasks, so the list can say how many are left. */
  total: number;
  nextCursor: string | null;
}

/**
 * One page of the reader's open Tasks due on or before `today` (their
 * `YYYY-MM-DD`), owned or assigned to them, earliest first. Core filters
 * before it limits, so old overdue work is never crowded out by recent
 * Tasks, and `cursor` continues the same query. Null on failure.
 */
export function loadMyDay(
  today: string,
  cursor: string | null = null,
): Promise<MyDayPage | null> {
  return taskService
    .listTasks({
      scope: "mine",
      dueOnTo: today,
      sort: "dueOn",
      status: MY_DAY_STATUSES,
      limit: MY_DAY_LIMIT,
      cursor,
    })
    .then(({ tasks, pagination }) => ({
      rows: tasks.map((task) => ({
        id: task.id,
        name: task.name,
        status: task.status,
        dueOn: task.dueOn,
        href: taskHref(task),
      })),
      total: pagination?.total ?? tasks.length,
      nextCursor: pagination?.nextCursor ?? null,
    }))
    .catch((error: unknown) => {
      console.warn("My day feed failed", { error });
      return null;
    });
}

/**
 * Home's "My day": what the reader should finish today or already missed.
 * Renders nothing when nothing is due, so a calm day stays calm.
 */
export async function MyDay({
  feed,
  today,
}: {
  feed: Promise<MyDayPage | null>;
  today: string;
}) {
  const [page, t] = await Promise.all([
    feed,
    getTranslations("App.Chat.Landing.MyDay"),
  ]);
  if (!page || page.rows.length === 0) return null;

  return (
    <section aria-label={t("title")} data-testid="home-my-day">
      <h2 className="text-foreground px-3 pb-2 text-sm font-medium">
        {t("title")}
      </h2>
      <MyDayList today={today} initial={page} />
    </section>
  );
}
