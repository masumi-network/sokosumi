import { sortTaskEventsAscending } from "@/app/tasks/utils/task-activity-feed";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { TaskEvent } from "@/lib/clients/generated/core/types.gen";

export const ACTIVITY_VARIANTS = [
  "status-folds",
  "recent-window",
  "digest",
] as const;

export type ActivityVariant = (typeof ACTIVITY_VARIANTS)[number];

export const ACTIVITY_VARIANT_LABELS: Record<ActivityVariant, string> = {
  "status-folds": "Status folds",
  "recent-window": "Recent window",
  digest: "Digest",
};

export function isActivityVariant(value: string): value is ActivityVariant {
  return (ACTIVITY_VARIANTS as readonly string[]).includes(value);
}

/** At or under this many events nothing collapses, in every variant. */
export const ACTIVITY_COLLAPSE_THRESHOLD = 5;

/** Newest events that always render in full. */
export const ACTIVITY_RECENT_WINDOW = 5;

/**
 * Results and every ask for the reader never fold, in any variant. These are
 * the rows a person opens the task to find.
 */
const KEYSTONE_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.INPUT_REQUIRED,
  TaskStatus.APPROVAL_REQUIRED,
  TaskStatus.AUTHENTICATION_REQUIRED,
  TaskStatus.OUT_OF_CREDITS,
]);

export function isKeystoneEvent(event: TaskEvent): boolean {
  return event.status != null && KEYSTONE_STATUSES.has(event.status);
}

function isFoldableStatusChange(event: TaskEvent): boolean {
  return (
    event.comment == null && event.status != null && !isKeystoneEvent(event)
  );
}

function isPlainComment(event: TaskEvent): boolean {
  return event.comment != null && !isKeystoneEvent(event);
}

export type ActivityVariantItem =
  | { type: "event"; event: TaskEvent; compact: boolean }
  | { type: "fold"; id: string; events: TaskEvent[] };

interface BuildOptions {
  /** Fold ids (first hidden event id) the reader opened. */
  openedFolds: ReadonlySet<string>;
  /** Digest only: compact comments the reader opened. */
  openedComments?: ReadonlySet<string>;
}

const MIN_FOLD_SIZE = 2;

function pushRun(
  items: ActivityVariantItem[],
  run: TaskEvent[],
  openedFolds: ReadonlySet<string>,
): void {
  const first = run[0];
  if (!first) {
    return;
  }
  if (run.length >= MIN_FOLD_SIZE && !openedFolds.has(first.id)) {
    items.push({ type: "fold", id: first.id, events: [...run] });
    return;
  }
  for (const event of run) {
    items.push({ type: "event", event, compact: false });
  }
}

function asEvents(ordered: readonly TaskEvent[]): ActivityVariantItem[] {
  return ordered.map((event) => ({ type: "event", event, compact: false }));
}

/**
 * Linear's rule: comments never fold. Consecutive status changes fold into
 * one row. The newest event never folds.
 */
export function buildStatusFoldItems(
  events: readonly TaskEvent[],
  { openedFolds }: BuildOptions,
): ActivityVariantItem[] {
  const ordered = sortTaskEventsAscending(events);
  if (ordered.length <= ACTIVITY_COLLAPSE_THRESHOLD) {
    return asEvents(ordered);
  }

  const items: ActivityVariantItem[] = [];
  let run: TaskEvent[] = [];
  ordered.forEach((event, index) => {
    const isNewest = index === ordered.length - 1;
    if (!isNewest && isFoldableStatusChange(event)) {
      run.push(event);
      return;
    }
    pushRun(items, run, openedFolds);
    run = [];
    items.push({ type: "event", event, compact: false });
  });
  pushRun(items, run, openedFolds);
  return items;
}

/**
 * The newest five stay open. Everything older folds, comments included,
 * except keystones, which stay where they happened and split the folds.
 */
export function buildRecentWindowItems(
  events: readonly TaskEvent[],
  { openedFolds }: BuildOptions,
): ActivityVariantItem[] {
  const ordered = sortTaskEventsAscending(events);
  if (ordered.length <= ACTIVITY_COLLAPSE_THRESHOLD) {
    return asEvents(ordered);
  }

  const windowStart = ordered.length - ACTIVITY_RECENT_WINDOW;
  const items: ActivityVariantItem[] = [];
  let gap: TaskEvent[] = [];
  ordered.forEach((event, index) => {
    if (index >= windowStart || isKeystoneEvent(event)) {
      pushRun(items, gap, openedFolds);
      gap = [];
      items.push({ type: "event", event, compact: false });
      return;
    }
    gap.push(event);
  });
  pushRun(items, gap, openedFolds);
  return items;
}

/**
 * Nothing leaves the page. Status changes fold as in Linear, and comments
 * older than the newest five shrink to one line until opened.
 */
export function buildDigestItems(
  events: readonly TaskEvent[],
  options: BuildOptions,
): ActivityVariantItem[] {
  const ordered = sortTaskEventsAscending(events);
  if (ordered.length <= ACTIVITY_COLLAPSE_THRESHOLD) {
    return asEvents(ordered);
  }

  const windowStart = ordered.length - ACTIVITY_RECENT_WINDOW;
  const recentIds = new Set(ordered.slice(windowStart).map(({ id }) => id));
  const openedComments = options.openedComments ?? new Set<string>();

  return buildStatusFoldItems(ordered, options).map((item) =>
    item.type === "event" &&
    !recentIds.has(item.event.id) &&
    isPlainComment(item.event) &&
    !openedComments.has(item.event.id)
      ? { ...item, compact: true }
      : item,
  );
}

export function buildActivityVariantItems(
  variant: ActivityVariant,
  events: readonly TaskEvent[],
  options: BuildOptions,
): ActivityVariantItem[] {
  switch (variant) {
    case "status-folds":
      return buildStatusFoldItems(events, options);
    case "recent-window":
      return buildRecentWindowItems(events, options);
    case "digest":
      return buildDigestItems(events, options);
  }
}
