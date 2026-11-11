import type { NotificationItem, TaskListItem } from "@sokosumi/core-client";
import { TASK_INPUT_REQUIRED_MESSAGE_KEY } from "@sokosumi/utils";
import { queryOptions } from "@tanstack/react-query";
import { COLUMN_TASK_STATUSES } from "@/app/tasks/utils/task-column";
import { coreClient } from "@/lib/clients/core.browser.client";

/** Every reader's and workspace's waiting-Tasks query starts with this. */
export const NEEDS_YOU_TASKS_QUERY_KEY = ["needs-you-tasks"] as const;

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
  });
}

/**
 * Whether a Task's ask is one the list above already shows, so Needs you
 * leaves the row out. Only asks from the workspace the list reads are: an
 * ask from another workspace stays a row and keeps its way there. Core's
 * Needs you count leaves out the same asks.
 */
export function isTaskAskListed(
  notification: Pick<
    NotificationItem,
    "messageKey" | "referenceId" | "metadata"
  >,
  waiting: NeedsYouTasks | undefined,
): boolean {
  if (notification.messageKey !== TASK_INPUT_REQUIRED_MESSAGE_KEY || !waiting) {
    return false;
  }
  const workspaceId = waiting.tasks[0]?.workspace.id;
  return (
    (workspaceId !== undefined &&
      notification.metadata?.workspaceId === workspaceId) ||
    waiting.tasks.some((task) => task.id === notification.referenceId)
  );
}
