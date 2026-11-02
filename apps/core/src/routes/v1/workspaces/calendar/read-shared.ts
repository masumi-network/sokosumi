import type { z } from "@hono/zod-openapi";
import type { Prisma, TaskStatus } from "@sokosumi/database";

import type {
  CalendarType,
  workspaceCalendarEntrySchema,
} from "@/schemas/workspace-calendar.schema";
import type { TaskScheduleReader } from "@/services/task-schedule.service";

export interface CalendarCursor {
  id: string;
  scheduledAt: string;
}

export interface WorkspaceCalendarReadQuery {
  includeSocialPosts?: boolean;
  types?: CalendarType[];
  timeZone?: string;
  agendaOnly?: boolean;
  assigneeId?: string;
  assigneeUserId?: string;
  from: Date;
  to: Date;
  cursor: CalendarCursor | null;
  requestedCursor: string | null;
  limit: number;
  scope: "owned" | "workspace";
  status?: TaskStatus;
}

/**
 * What the caller may read: the Tasks that released Runs created, and, as
 * `scheduleReader`, whose Task Schedules' planned Runs it sees and changes
 * (by the Task Schedule rules). A null reader sees no planned Runs.
 */
export interface CalendarAccessWhere {
  scheduleReader: TaskScheduleReader | null;
  task: Prisma.TaskWhereInput;
}

export interface WorkspaceCalendarReadOptions {
  projectId?: string;
  sourceId?: string;
  access?: CalendarAccessWhere;
}

export type CalendarEntry = z.infer<typeof workspaceCalendarEntrySchema>;

export interface CalendarReadContext {
  workspaceId: string;
  userId: string;
  query: WorkspaceCalendarReadQuery;
  options: WorkspaceCalendarReadOptions;
}

/** One feature's entries: at most limit + 1 after the cursor, and how many the range holds. */
export interface CalendarReaderResult {
  items: CalendarEntry[];
  total: number;
}

export type CalendarReader = (
  ctx: CalendarReadContext,
) => Promise<CalendarReaderResult>;

export const NO_ENTRIES: CalendarReaderResult = { items: [], total: 0 };

/**
 * Entries sort by (scheduledAt, id). Run and Run at ids are lowercase UUIDs;
 * every other id starts with a prefix above any UUID ("followup:",
 * "marketing:", "newsletter:", "social:"). So after a non-UUID cursor no Run
 * is left at the cursor's time, and a prefixed kind tells from the cursor
 * alone which of its entries follow.
 */
export function compareEntries(a: CalendarCursor, b: CalendarCursor): number {
  return (
    a.scheduledAt.localeCompare(b.scheduledAt) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * The id filter for a prefixed kind's entries at the cursor's own time: the
 * ones after the cursor when it is one of them, all when its id sorts below
 * the prefix, none otherwise.
 */
export function idFilterAtCursorTime(
  prefix: string,
  cursor: CalendarCursor,
): { id?: { gt: string } } | null {
  if (cursor.id.startsWith(prefix)) {
    return { id: { gt: cursor.id.slice(prefix.length) } };
  }
  return prefix > cursor.id ? {} : null;
}

/** For readers that filter in memory: their entries after the cursor, in order. */
export function pageInMemory(
  entries: CalendarEntry[],
  { query }: CalendarReadContext,
): CalendarReaderResult {
  const { cursor } = query;
  return {
    items: entries
      .filter((entry) => !cursor || compareEntries(entry, cursor) > 0)
      .sort(compareEntries)
      .slice(0, query.limit + 1),
    total: entries.length,
  };
}
