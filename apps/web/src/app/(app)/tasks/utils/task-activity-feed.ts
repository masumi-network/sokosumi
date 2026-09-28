import { TaskStatus } from "@/lib/clients/generated/core";
import type { TaskEvent } from "@/lib/clients/generated/core/types.gen";

/** At or under this many events the feed renders every event in full. */
export const TASK_ACTIVITY_COLLAPSE_THRESHOLD = 5;

/** Newest events that always render in full once the feed collapses. */
export const TASK_ACTIVITY_RECENT_WINDOW = 5;

/** List name for chat land-and-highlight (`highlightListMessage`). */
export const TASK_ACTIVITY_MESSAGE_LIST = "task-activity";

export function isTaskActivityComment(event: TaskEvent): boolean {
  return event.comment != null;
}

export function sortTaskEventsAscending(
  events: readonly TaskEvent[],
): TaskEvent[] {
  return [...events].sort((a, b) => {
    const byTime =
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (byTime !== 0) {
      return byTime;
    }
    return a.id.localeCompare(b.id);
  });
}

export function getLatestTaskEventId(
  events: readonly TaskEvent[],
): string | null {
  const ordered = sortTaskEventsAscending(events);
  return ordered.at(-1)?.id ?? null;
}

/**
 * Auth / out-of-credits CTAs attach only when the chronologically latest event
 * matches — not list index 0 after ascending render.
 */
export function isLatestMatchingStatusEvent(
  event: TaskEvent,
  latestEventId: string | null,
  status:
    | typeof TaskStatus.AUTHENTICATION_REQUIRED
    | typeof TaskStatus.OUT_OF_CREDITS,
): boolean {
  return (
    latestEventId != null &&
    event.id === latestEventId &&
    event.status === status
  );
}

const OUTCOME_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
]);

const ASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.INPUT_REQUIRED,
  TaskStatus.APPROVAL_REQUIRED,
  TaskStatus.AUTHENTICATION_REQUIRED,
  TaskStatus.OUT_OF_CREDITS,
]);

/**
 * The ask the task is waiting on right now: the newest status event, when it
 * asks the reader for something. Once the status moves on, that ask is
 * history like any other event.
 */
export function findOpenAskEventId(
  events: readonly TaskEvent[],
): string | null {
  const latestStatusEvent = sortTaskEventsAscending(events).findLast(
    (event) => event.status != null,
  );
  return latestStatusEvent?.status != null &&
    ASK_STATUSES.has(latestStatusEvent.status)
    ? latestStatusEvent.id
    : null;
}

export type TaskActivityFeedItem =
  | { type: "event"; event: TaskEvent; compact: boolean }
  | { type: "status-fold"; id: string; events: TaskEvent[] };

const MIN_STATUS_FOLD_SIZE = 2;

function pushStatusRun(
  items: TaskActivityFeedItem[],
  run: TaskEvent[],
  openedFolds: ReadonlySet<string>,
): void {
  const first = run[0];
  if (!first) {
    return;
  }
  if (run.length >= MIN_STATUS_FOLD_SIZE && !openedFolds.has(first.id)) {
    items.push({ type: "status-fold", id: first.id, events: [...run] });
    return;
  }
  for (const event of run) {
    items.push({ type: "event", event, compact: false });
  }
}

/**
 * Build the ascending digest. Past the threshold, events older than the
 * newest five collapse without leaving the page: runs of status changes fold
 * into one row and comments shrink to one line. Results and the open ask
 * always stay in full; an answered ask collapses like any other comment.
 *
 * Folds are keyed by their first event id and comments by their own id, so
 * the reader's opened set survives refreshes that append newer events.
 */
export function buildTaskActivityFeedItems(
  events: readonly TaskEvent[],
  options: {
    openedFolds: ReadonlySet<string>;
    openedComments: ReadonlySet<string>;
  },
): TaskActivityFeedItem[] {
  const ordered = sortTaskEventsAscending(events);
  if (ordered.length <= TASK_ACTIVITY_COLLAPSE_THRESHOLD) {
    return ordered.map((event) => ({ type: "event", event, compact: false }));
  }

  const windowStart = ordered.length - TASK_ACTIVITY_RECENT_WINDOW;
  const openAskId = findOpenAskEventId(ordered);
  const isPinned = (event: TaskEvent) =>
    event.id === openAskId ||
    (event.status != null && OUTCOME_STATUSES.has(event.status));

  const items: TaskActivityFeedItem[] = [];
  let run: TaskEvent[] = [];
  ordered.forEach((event, index) => {
    const isRecent = index >= windowStart;
    if (
      !isRecent &&
      event.comment == null &&
      event.status != null &&
      !isPinned(event)
    ) {
      run.push(event);
      return;
    }
    pushStatusRun(items, run, options.openedFolds);
    run = [];
    items.push({
      type: "event",
      event,
      compact:
        !isRecent &&
        event.comment != null &&
        !isPinned(event) &&
        !options.openedComments.has(event.id),
    });
  });
  pushStatusRun(items, run, options.openedFolds);
  return items;
}

/**
 * Merge pages without dupes, ascending.
 */
export function mergeTaskActivityEvents(
  existing: readonly TaskEvent[],
  incoming: readonly TaskEvent[],
): TaskEvent[] {
  const byId = new Map<string, TaskEvent>();
  for (const event of existing) {
    byId.set(event.id, event);
  }
  for (const event of incoming) {
    byId.set(event.id, event);
  }
  return sortTaskEventsAscending([...byId.values()]);
}
