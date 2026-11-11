"use client";

import { type TaskListItem, TaskStatus } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { getTaskStatusMarker } from "@/app/tasks/components/task-status-badge";
import { taskHref } from "@/app/tasks/utils/task-href";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusMarker } from "@/components/ui/status-marker";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { useNotificationTimeFormatter } from "@/lib/utils/notification-time";
import { needsYouTasksQueryOptions } from "@/queries/needs-you-tasks";

/** The Tasks waiting on the reader, shared by the tab count and the rows. */
export function useNeedsYouTasks() {
  const { data: session } = useSession();

  return useQuery(
    needsYouTasksQueryOptions(
      session?.user.id,
      session?.session.activeOrganizationId ?? null,
    ),
  );
}

/** The agent working the Task, who is the one asking. People are not named. */
function agentName(task: TaskListItem): string | null {
  if (task.assignee?.type === "sokoBot") {
    return task.assignee.sokoBot.name?.trim() || null;
  }
  if (task.assignee?.type === "coworker") {
    return task.assignee.coworker.name;
  }
  return null;
}

/** The statuses the list asks Core for, which are the ones Home counts. */
type WaitingStatus =
  | typeof TaskStatus.INPUT_REQUIRED
  | typeof TaskStatus.APPROVAL_REQUIRED
  | typeof TaskStatus.AUTHENTICATION_REQUIRED
  | typeof TaskStatus.OUT_OF_CREDITS
  | typeof TaskStatus.GRANT_PENDING;

/** The statuses where the agent asks the reader, so the line names it. */
type AskingStatus =
  | typeof TaskStatus.INPUT_REQUIRED
  | typeof TaskStatus.APPROVAL_REQUIRED
  | typeof TaskStatus.AUTHENTICATION_REQUIRED;

function isAskingStatus(status: TaskStatus): status is AskingStatus {
  return (
    status === TaskStatus.INPUT_REQUIRED ||
    status === TaskStatus.APPROVAL_REQUIRED ||
    status === TaskStatus.AUTHENTICATION_REQUIRED
  );
}

function isWaitingStatus(status: TaskStatus): status is WaitingStatus {
  return (
    isAskingStatus(status) ||
    status === TaskStatus.OUT_OF_CREDITS ||
    status === TaskStatus.GRANT_PENDING
  );
}

interface NotificationWaitingTasksProps {
  /** Closes the surrounding panel, which navigation does not unmount. */
  onNavigate?: () => void;
}

/**
 * The Tasks waiting on the reader, as the Needs you view lists them: the
 * same Tasks and the same number Home's "N tasks need your input" counts.
 * A Task's own ask is a notification row too, and the list leaves those
 * out of Needs you, so each waiting Task is here once.
 *
 * Each row is one link to the Task, which is where the answer is given. It
 * says who asks and for what, and ends in the move as a button-shaped label,
 * so the row reads as one stop rather than two links to the same place.
 */
export function NotificationWaitingTasks({
  onNavigate,
}: NotificationWaitingTasksProps) {
  const t = useTranslations("Components.NotificationCenter.WaitingTasks");
  const tCenter = useTranslations("Components.NotificationCenter");
  const formatTime = useNotificationTimeFormatter();
  const { data, isError, refetch } = useNeedsYouTasks();
  // The panel and the page can both be open, so the heading id is per frame.
  const headingId = useId();

  if (isError) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <p className="text-muted-foreground text-sm">{t("loadError")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
        >
          {tCenter("retry")}
        </Button>
      </div>
    );
  }

  if (!data || data.count === 0) {
    return null;
  }

  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-3 px-3 pt-3 pb-1">
        <h2 id={headingId} className="text-sm font-medium">
          {t("heading", { count: data.count })}
        </h2>
        {data.count > data.tasks.length ? (
          <Link
            href="/tasks"
            onClick={onNavigate}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm text-sm outline-none focus-visible:ring-2"
          >
            {t("showAll")}
          </Link>
        ) : null}
      </div>
      <ul className="divide-border divide-y">
        {data.tasks.map((task) => {
          // Core read only these statuses; the guard narrows the type.
          const status = isWaitingStatus(task.status)
            ? task.status
            : TaskStatus.INPUT_REQUIRED;
          const name = agentName(task);
          const summary =
            name && isAskingStatus(status)
              ? t(`ask.${status}`, { name })
              : t(`status.${status}`);
          const action = t(`action.${status}`);

          return (
            <li key={task.id}>
              <Link
                href={taskHref(task)}
                onClick={onNavigate}
                className="group/row hover:bg-accent focus-visible:ring-ring flex items-start gap-3 p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset"
              >
                <span
                  aria-hidden
                  className="bg-quinary flex size-8 shrink-0 items-center justify-center rounded-full"
                >
                  <StatusMarker
                    spec={getTaskStatusMarker(task.status)}
                    live={false}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm font-medium text-pretty break-words">
                    {task.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {summary}
                    {" · "}
                    <span className="tabular-nums">
                      {formatTime(task.updatedAt)}
                    </span>
                  </span>
                </span>
                <span
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "pointer-events-none shrink-0",
                  )}
                >
                  {action}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
