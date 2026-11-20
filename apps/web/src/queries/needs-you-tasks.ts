import {
  type NotificationItem,
  type TaskEvent,
  type TaskListItem,
  TaskStatus,
} from "@sokosumi/core-client";
import { TASK_INPUT_REQUIRED_MESSAGE_KEY } from "@sokosumi/utils";
import { queryOptions } from "@tanstack/react-query";
import { COLUMN_TASK_STATUSES } from "@/app/tasks/utils/task-column";
import { coreClient } from "@/lib/clients/core.browser.client";
import { collectCursorPages } from "@/lib/utils/collect-cursor-pages";

/** Every reader's and workspace's waiting-Tasks query starts with this. */
export const NEEDS_YOU_TASKS_QUERY_KEY = ["needs-you-tasks"] as const;

/** How often an open Needs you reads the waiting Tasks again. */
export const NEEDS_YOU_TASKS_REFRESH_MS = 30_000;

/** Rows the Needs you view lists before it sends the reader to Tasks. */
export const NEEDS_YOU_TASKS_LIMIT = 50;

export interface NeedsYouTasks {
  /** Home's "N tasks need your input" number, from the same Core summary. */
  count: number;
  /** The newest waiting Tasks, at most {@link NEEDS_YOU_TASKS_LIMIT} in the initial list. Page search includes older Tasks. */
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
  complete = false,
) {
  const scope = organizationId ? "workspace" : "owned";

  return queryOptions({
    queryKey: [
      ...NEEDS_YOU_TASKS_QUERY_KEY,
      userId ?? null,
      organizationId,
      complete,
    ],
    queryFn: async (): Promise<NeedsYouTasks> => {
      const readPage = async (cursor?: string) => {
        const page = await coreClient.getTasks({
          scope,
          status: COLUMN_TASK_STATUSES["input-required"],
          // A blocked sub-task needs the reader as much as its parent does,
          // and the summary count above includes it.
          includeSubtasks: "true",
          sort: "updatedAt",
          limit: NEEDS_YOU_TASKS_LIMIT,
          ...(cursor && { cursor }),
        });
        return {
          items: page.data,
          nextCursor: page.meta?.pagination?.nextCursor,
        };
      };
      const [summary, list] = await Promise.all([
        coreClient.getTasksSummary({ scope }),
        readPage(),
      ]);

      const tasks = complete
        ? await collectCursorPages(list.items, list.nextCursor, readPage)
        : list.items;
      return { count: summary.data.awaitingInput, tasks };
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

/**
 * What the agent asked for the current wait: the comment it parked the Task
 * with, else its newest comment since the Task last left Input required.
 * People's comments (they carry a `userId`) are never the question. Null
 * when this wait has no question of its own, rather than an older one.
 */
export function waitingQuestion(events: TaskEvent[]): string | null {
  const lastOther = events.findLastIndex(
    (event) => event.status && event.status !== TaskStatus.INPUT_REQUIRED,
  );
  const wait = events.slice(lastOther + 1);
  const asked = wait.findLast(
    (event) => event.status === TaskStatus.INPUT_REQUIRED && event.comment,
  );
  const fallback = wait.findLast((event) => !event.userId && event.comment);
  return (asked ?? fallback)?.comment ?? null;
}

/**
 * Whether the Task's history still ends in the wait the list shows: its
 * newest status event asked for input at `statusSince`. False once it has
 * resumed or asked again, so a stale row never offers an answer to it.
 */
export function isCurrentWait(
  events: TaskEvent[],
  statusSince: Date | string,
): boolean {
  const last = events.findLast((event) => event.status);
  return (
    last?.status === TaskStatus.INPUT_REQUIRED &&
    new Date(last.createdAt).getTime() === new Date(statusSince).getTime()
  );
}
