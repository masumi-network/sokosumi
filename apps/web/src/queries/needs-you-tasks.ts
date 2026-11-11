import type { NotificationItem, TaskListItem } from "@sokosumi/core-client";
import { TASK_INPUT_REQUIRED_MESSAGE_KEY } from "@sokosumi/utils";
import { queryOptions } from "@tanstack/react-query";
import { COLUMN_TASK_STATUSES } from "@/app/tasks/utils/task-column";
import { coreClient } from "@/lib/clients/core.browser.client";

/** Every reader's and workspace's waiting-Tasks query starts with this. */
export const NEEDS_YOU_TASKS_QUERY_KEY = ["needs-you-tasks"] as const;

/** How often an open Needs you reads the waiting Tasks again. */
export const NEEDS_YOU_TASKS_REFRESH_MS = 30_000;

/** Rows the Needs you view lists before it sends the reader to Tasks. */
export const NEEDS_YOU_TASKS_LIMIT = 50;

export interface NeedsYouTasks {
  /** Home's "N tasks need your input" number, from the same Core summary. */
  count: number;
  /** The newest waiting Tasks, at most {@link NEEDS_YOU_TASKS_LIMIT}. */
  tasks: TaskListItem[];
}

/**
 * The Tasks waiting on the reader, as Home counts them: the input-required
 * statuses, over the workspace in an organization and over the reader's own
 * Tasks in a personal workspace (the scope Home passes to the summary). The
 * number is the summary's own `awaitingInput`, so Home and the Needs you tab
 * cannot disagree; the rows are the same filter on the Task list.
 *
 * Keyed by reader and workspace: the browser query client outlives a sign-out
 * and a workspace switch.
 */
export function needsYouTasksQueryOptions(
  userId: string | undefined,
  organizationId: string | null,
) {
  const scope = organizationId ? "workspace" : "owned";

  return queryOptions({
    queryKey: [...NEEDS_YOU_TASKS_QUERY_KEY, userId ?? null, organizationId],
    queryFn: async (): Promise<NeedsYouTasks> => {
      const [summary, list] = await Promise.all([
        coreClient.getTasksSummary({ scope }),
        coreClient.getTasks({
          scope,
          status: COLUMN_TASK_STATUSES["input-required"],
          sort: "updatedAt",
          limit: NEEDS_YOU_TASKS_LIMIT,
        }),
      ]);

      return { count: summary.data.awaitingInput, tasks: list.data };
    },
    // Without a session both reads are a guaranteed 401.
    enabled: Boolean(userId),
    // A Task is answered on its own page, and the Needs you view that asked
    // for it opens again a moment later. The app-wide minute of freshness
    // would show it as still waiting, so every new reader of the list reads
    // it again; realtime Task events refresh it while it stays open.
    staleTime: 0,
    // Realtime Task events reach a Task's owner only, and in an organization
    // this list holds teammates' Tasks too. So while the list or its tab is
    // on screen it reads again on a timer; a hidden browser tab does not.
    // ponytail: poll, a workspace Task channel if this ever needs to be live.
    refetchInterval: NEEDS_YOU_TASKS_REFRESH_MS,
  });
}

/**
 * Whether a Task's ask is for a Task the list above shows, so Needs you
 * leaves the row out. Core already leaves out the asks of every Task the
 * active workspace lists, judged by where the Task is now; this catches an
 * ask that arrives live before the next read. A Task the list does not show
 * keeps its row, wherever the ask was first written.
 */
export function isTaskAskListed(
  notification: Pick<NotificationItem, "messageKey" | "referenceId">,
  waiting: NeedsYouTasks | undefined,
): boolean {
  return (
    notification.messageKey === TASK_INPUT_REQUIRED_MESSAGE_KEY &&
    waiting !== undefined &&
    waiting.tasks.some((task) => task.id === notification.referenceId)
  );
}
