import type { TaskListItem } from "@sokosumi/core-client";
import { queryOptions } from "@tanstack/react-query";
import { COLUMN_TASK_STATUSES } from "@/app/tasks/utils/task-column";
import { coreClient } from "@/lib/clients/core.browser.client";

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
    queryKey: ["needs-you-tasks", userId ?? null, organizationId],
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
  });
}
