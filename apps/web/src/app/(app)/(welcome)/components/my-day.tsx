import type { TaskListItem } from "@sokosumi/core-client";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { TaskDueBadge } from "@/app/tasks/components/task-due-badge";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { FINISHED_STATUSES } from "@/app/tasks/utils/task-due";
import { taskHref } from "@/app/tasks/utils/task-href";
import { taskService } from "@/lib/services/task.service";
import { TASK_STATUS_DISPLAY_ORDER } from "@/lib/utils/task-status-order";

export const MY_DAY_LIMIT = 5;

/** Every status a due date still presses on. */
export const MY_DAY_STATUSES = TASK_STATUS_DISPLAY_ORDER.filter(
  (status) => !FINISHED_STATUSES.includes(status),
);

interface MyDayFeed {
  tasks: TaskListItem[];
  /** All matching Tasks, so a cut-off list can say how many it left out. */
  total: number;
}

/**
 * The reader's open Tasks due on or before `today` (their `YYYY-MM-DD`),
 * owned or assigned to them, earliest first. Core filters before it limits,
 * so old overdue work is never crowded out by recent Tasks. Null on failure:
 * Home hides the list rather than erroring.
 */
export function loadMyDay(today: string): Promise<MyDayFeed | null> {
  return taskService
    .listTasks({
      scope: "mine",
      dueOnTo: today,
      sort: "dueOn",
      status: MY_DAY_STATUSES,
      limit: MY_DAY_LIMIT,
    })
    .then(({ tasks, pagination }) => ({
      tasks,
      total: pagination?.total ?? tasks.length,
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
export async function MyDay({ feed }: { feed: Promise<MyDayFeed | null> }) {
  const [day, t, tStatus] = await Promise.all([
    feed,
    getTranslations("App.Chat.Landing.MyDay"),
    getTranslations("App.Tasks.Filters.statusOptions"),
  ]);
  if (!day || day.tasks.length === 0) return null;
  const more = day.total - day.tasks.length;

  return (
    <section aria-label={t("title")} data-testid="home-my-day">
      <div className="flex items-baseline justify-between gap-3 px-3 pb-2">
        <h2 className="text-foreground text-sm font-medium">{t("title")}</h2>
        {more > 0 ? (
          <Link
            href="/tasks"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm text-sm outline-none transition-colors focus-visible:ring-2"
          >
            {t("more", { count: more })}
          </Link>
        ) : null}
      </div>
      <ul className="flex flex-col">
        {day.tasks.map((task) => (
          <li key={task.id} data-testid="home-my-day-row">
            <Link
              href={taskHref(task)}
              className="hover:bg-accent focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-md px-3 py-2 outline-none transition-colors focus-visible:ring-2"
            >
              <TaskStatusBadge
                status={task.status}
                label={tStatus(task.status)}
                showLabel={false}
                className="border-0 bg-transparent p-0"
              />
              <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                {task.name}
              </span>
              {task.dueOn ? (
                <TaskDueBadge
                  dueOn={task.dueOn}
                  status={task.status}
                  className="shrink-0 text-sm"
                />
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
