import type { TaskStatus } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";
import { FINISHED_STATUSES, shiftDay } from "@/app/tasks/utils/task-due";
import { taskHref } from "@/app/tasks/utils/task-href";
import { taskService } from "@/lib/services/task.service";
import { TASK_STATUS_DISPLAY_ORDER } from "@/lib/utils/task-status-order";
import { MoveOverdueMenu } from "./move-overdue-menu.client";
import { MyDayList } from "./my-day-list.client";

export const MY_DAY_LIMIT = 5;

/** Every status a due date still presses on. */
export const MY_DAY_STATUSES = TASK_STATUS_DISPLAY_ORDER.filter(
  (status) => !FINISHED_STATUSES.includes(status),
);

/**
 * The most overdue Tasks one move re-dates (Core's cap). Anything past it
 * stays overdue and the menu offers it again after the move.
 */
const MOVE_OVERDUE_LIMIT = 100;

/** Overdue work a move may re-date: open, and not parked on a vendor grant. */
const MOVABLE_STATUSES = MY_DAY_STATUSES.filter(
  (status) => status !== "GRANT_PENDING",
);

/**
 * How many Tasks "Move overdue" would re-date: the reader's open Tasks due
 * before `today`, owned or assigned to them in the active workspace. Core
 * picks the same set when the move runs. 0 on failure hides the menu.
 */
export function countOverdue(today: string): Promise<number> {
  return taskService
    .listTasks({
      scope: "mine",
      dueOnTo: shiftDay(today, -1),
      status: MOVABLE_STATUSES,
      limit: 1,
    })
    .then(({ tasks, pagination }) =>
      Math.min(pagination?.total ?? tasks.length, MOVE_OVERDUE_LIMIT),
    )
    .catch((error: unknown) => {
      console.warn("Overdue count failed", { error });
      return 0;
    });
}

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
  overdue,
  today,
}: {
  feed: Promise<MyDayPage | null>;
  /** How many Tasks "Move overdue" would re-date. */
  overdue: Promise<number>;
  today: string;
}) {
  const [page, overdueCount, t] = await Promise.all([
    feed,
    overdue,
    getTranslations("App.Chat.Landing.MyDay"),
  ]);
  if (!page || page.rows.length === 0) return null;

  return (
    <section aria-label={t("title")} data-testid="home-my-day">
      <div className="flex items-center justify-between gap-2 px-3 pb-2">
        <h2 className="text-foreground text-sm font-medium">{t("title")}</h2>
        {overdueCount > 0 ? (
          <MoveOverdueMenu today={today} count={overdueCount} />
        ) : null}
      </div>
      <MyDayList today={today} initial={page} />
    </section>
  );
}
