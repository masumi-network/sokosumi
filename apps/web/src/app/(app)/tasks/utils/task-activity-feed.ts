import { TaskStatus } from "@/lib/clients/generated/core";
import type { TaskEvent } from "@/lib/clients/generated/core/types.gen";

/** Visible comments when the thread is collapsed. More than this → group chrome. */
export const TASK_ACTIVITY_VISIBLE_COMMENT_LIMIT = 5;

export const TASK_ACTIVITY_EVENTS_PAGE_LIMIT = 100;

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

export type TaskActivityFeedItem =
  | { type: "event"; event: TaskEvent }
  | {
      type: "comment-group";
      hiddenCount: number;
      hiddenEventIds: string[];
    };

/**
 * Build the ascending feed. When `commentCount` > 5 and comments are collapsed,
 * older comments become one group immediately before the newest visible comments.
 * Leading non-comment events stay above so the list reads first event → Show older → newest.
 */
export function buildTaskActivityFeedItems(
  events: readonly TaskEvent[],
  options: {
    commentCount: number;
    commentsExpanded: boolean;
  },
): TaskActivityFeedItem[] {
  const ordered = sortTaskEventsAscending(events);
  const { commentCount, commentsExpanded } = options;

  if (commentsExpanded || commentCount <= TASK_ACTIVITY_VISIBLE_COMMENT_LIMIT) {
    return ordered.map((event) => ({ type: "event" as const, event }));
  }

  const loadedComments = ordered.filter(isTaskActivityComment);
  const hiddenEventIds: string[] = [];
  let commentLocalIndex = 0;

  for (const event of ordered) {
    if (!isTaskActivityComment(event)) {
      continue;
    }
    const globalIndex =
      commentCount - loadedComments.length + commentLocalIndex;
    commentLocalIndex += 1;
    if (globalIndex < commentCount - TASK_ACTIVITY_VISIBLE_COMMENT_LIMIT) {
      hiddenEventIds.push(event.id);
    }
  }

  const unloadedOlderCommentCount = Math.max(
    0,
    commentCount - loadedComments.length,
  );
  const visibleLoadedCommentCount =
    loadedComments.length - hiddenEventIds.length;
  const totalHidden = commentCount - visibleLoadedCommentCount;

  if (totalHidden <= 0) {
    return ordered.map((event) => ({ type: "event" as const, event }));
  }

  const hiddenSet = new Set(hiddenEventIds);
  const items: TaskActivityFeedItem[] = [];
  let groupInserted = false;

  const insertGroup = () => {
    if (groupInserted) {
      return;
    }
    items.push({
      type: "comment-group",
      hiddenCount: totalHidden,
      hiddenEventIds,
    });
    groupInserted = true;
  };

  for (const event of ordered) {
    if (hiddenSet.has(event.id)) {
      continue;
    }
    // Insert the group immediately before the first visible comment so leading
    // status/billing/auth events stay above Show older.
    if (
      isTaskActivityComment(event) &&
      !groupInserted &&
      (hiddenEventIds.length > 0 || unloadedOlderCommentCount > 0)
    ) {
      insertGroup();
    }
    items.push({ type: "event", event });
  }

  if (!groupInserted && totalHidden > 0) {
    insertGroup();
  }

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
