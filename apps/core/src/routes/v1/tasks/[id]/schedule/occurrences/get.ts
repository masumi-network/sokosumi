import { createRoute, z } from "@hono/zod-openapi";
import { type Prisma, TaskScheduleOccurrenceState } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS, hasActiveTaskSchedule } from "@sokosumi/utils";

import { requireTaskOwnership } from "@/helpers/access-control";
import { requireCalendarBetaAccess } from "@/helpers/calendar-beta-access";
import { getCalendarSourceId } from "@/helpers/calendar-source";
import { badRequest, conflict } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  CALENDAR_OCCURRENCE_HORIZON_MS,
  countTaskScheduleFutureExceptions,
} from "@/helpers/task-schedule-occurrence-index";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import {
  type TaskScheduleOccurrenceView,
  taskScheduleOccurrencePageSchema,
  taskScheduleOccurrenceQuerySchema,
} from "@/schemas/task-schedule-occurrence.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/schedule/occurrences",
  description:
    "List the schedule occurrence ledger of a series. Cursors are bound to the view and to the schedule revision they were minted at.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    query: taskScheduleOccurrenceQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      taskScheduleOccurrencePageSchema,
      "Task schedule occurrences",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export interface TaskScheduleOccurrenceCursor {
  view: TaskScheduleOccurrenceView;
  scheduleRevision: number;
  effectiveScheduledAt: string;
  id: string;
}

export function encodeTaskScheduleOccurrenceCursor(
  cursor: TaskScheduleOccurrenceCursor,
): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function isTaskScheduleOccurrenceCursor(
  value: unknown,
): value is TaskScheduleOccurrenceCursor {
  return (
    typeof value === "object" &&
    value !== null &&
    "view" in value &&
    "scheduleRevision" in value &&
    "effectiveScheduledAt" in value &&
    "id" in value &&
    (value.view === "upcoming" || value.view === "history") &&
    Number.isInteger(value.scheduleRevision) &&
    typeof value.effectiveScheduledAt === "string" &&
    // The id keys a `@db.Uuid` column, so a non-UUID must fail as a bad cursor
    // here rather than as a Postgres cast error inside the keyset predicate.
    z.uuid().safeParse(value.id).success &&
    !Number.isNaN(new Date(value.effectiveScheduledAt).getTime())
  );
}

function decodeTaskScheduleOccurrenceCursor(
  cursor: string,
): TaskScheduleOccurrenceCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw badRequest("cursor is invalid");
  }
  if (!isTaskScheduleOccurrenceCursor(parsed)) {
    throw badRequest("cursor is invalid");
  }
  return parsed;
}

/**
 * A cursor is a keyset into one ordering of one revision of the ledger. Any
 * series mutation renumbers that ordering, so replaying an older cursor would
 * silently skip or repeat rows; the client discards its pages and reloads.
 */
function requireFreshCursor(
  cursor: TaskScheduleOccurrenceCursor,
  view: TaskScheduleOccurrenceView,
  scheduleRevision: number,
): void {
  if (cursor.view !== view || cursor.scheduleRevision !== scheduleRevision) {
    throw conflict(
      "The schedule series changed; reload the first page of occurrences",
      { kind: CORE_API_ERROR_KINDS.SCHEDULE_CURSOR_STALE },
    );
  }
}

/**
 * `upcoming` and `history` partition the ledger: everything still ahead of the
 * caller inside the projection horizon, and everything the series already
 * decided — released, canceled, and the past planned or skipped rows that
 * removal and rule edits deliberately preserve.
 */
function buildViewWhere(
  seriesTaskId: string,
  view: TaskScheduleOccurrenceView,
  now: Date,
): Prisma.TaskScheduleOccurrenceWhereInput {
  if (view === "upcoming") {
    return {
      seriesTaskId,
      state: {
        in: [
          TaskScheduleOccurrenceState.PLANNED,
          TaskScheduleOccurrenceState.SKIPPED,
        ],
      },
      effectiveScheduledAt: {
        gte: now,
        lt: new Date(now.getTime() + CALENDAR_OCCURRENCE_HORIZON_MS),
      },
    };
  }

  return {
    seriesTaskId,
    OR: [
      {
        state: {
          in: [
            TaskScheduleOccurrenceState.RELEASED,
            TaskScheduleOccurrenceState.CANCELED,
          ],
        },
      },
      {
        state: {
          in: [
            TaskScheduleOccurrenceState.PLANNED,
            TaskScheduleOccurrenceState.SKIPPED,
          ],
        },
        effectiveScheduledAt: { lt: now },
      },
    ],
  };
}

function buildCursorWhere(
  cursor: TaskScheduleOccurrenceCursor,
  view: TaskScheduleOccurrenceView,
): Prisma.TaskScheduleOccurrenceWhereInput {
  const effectiveScheduledAt = new Date(cursor.effectiveScheduledAt);
  const comparison = view === "upcoming" ? "gt" : "lt";

  return {
    OR: [
      { effectiveScheduledAt: { [comparison]: effectiveScheduledAt } },
      { effectiveScheduledAt, id: { [comparison]: cursor.id } },
    ],
  };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = requireOwnerUserContext(authContext);
    await requireCalendarBetaAccess(userContext.userId, prisma);
    const { id } = c.req.valid("param");
    const { view, cursor: requestedCursor, limit } = c.req.valid("query");

    // Ownership only: this is the read half of the collaboration audience
    // (`requireOwnerUserContext` already rejected non-human actors), without
    // the parked-task guard that belongs to the series mutations. Inspecting
    // history is not modifying the Task.
    //
    // The ledger outlives its series: a removed schedule still answers with the
    // preserved history and the Task's current revision.
    const task = await requireTaskOwnership(userContext, id, prisma);
    const { scheduleRevision } = task;

    const cursor = requestedCursor
      ? decodeTaskScheduleOccurrenceCursor(requestedCursor)
      : null;
    if (cursor) {
      requireFreshCursor(cursor, view, scheduleRevision);
    }

    const now = new Date();
    const viewWhere = buildViewWhere(id, view, now);
    const direction = view === "upcoming" ? "asc" : "desc";
    // Every page carries the whole series' exception count, at the same `now`
    // as the view filter, so the edit surface can decide whether to confirm a
    // destructive discard without paging the ledger. A series with no live
    // rule has nothing left to discard.
    const futureExceptionCount = hasActiveTaskSchedule(
      task.metadata,
      task.nextRunAt,
    )
      ? await countTaskScheduleFutureExceptions(prisma, id, now)
      : 0;
    const [rows, total] = await Promise.all([
      prisma.taskScheduleOccurrence.findMany({
        where: cursor
          ? { ...viewWhere, AND: [buildCursorWhere(cursor, view)] }
          : viewWhere,
        take: limit + 1,
        orderBy: [{ effectiveScheduledAt: direction }, { id: direction }],
        select: {
          id: true,
          state: true,
          scheduleVersion: true,
          epochId: true,
          originalScheduledAt: true,
          effectiveScheduledAt: true,
          timezone: true,
          sourceWorkspaceId: true,
          sourceType: true,
          sourceProjectId: true,
          sourceAccuracy: true,
          timeAccuracy: true,
          releasedTask: {
            select: {
              id: true,
              name: true,
              status: true,
              archivedAt: true,
            },
          },
        },
      }),
      prisma.taskScheduleOccurrence.count({ where: viewWhere }),
    ]);

    const page = rows.slice(0, limit);
    const last = page.at(-1);

    return ok(
      c,
      taskScheduleOccurrencePageSchema.parse({
        scheduleRevision,
        futureExceptionCount,
        occurrences: page.map((occurrence) => ({
          ...occurrence,
          sourceId: getCalendarSourceId(occurrence),
          // A planned row whose time has passed never released: history shows
          // it as a missed run instead of an upcoming one.
          isMissed:
            occurrence.state === TaskScheduleOccurrenceState.PLANNED &&
            occurrence.effectiveScheduledAt < now,
        })),
      }),
      {
        cursor: requestedCursor ?? null,
        limit,
        total,
        nextCursor:
          rows.length > page.length && last
            ? encodeTaskScheduleOccurrenceCursor({
                view,
                scheduleRevision,
                effectiveScheduledAt: last.effectiveScheduledAt.toISOString(),
                id: last.id,
              })
            : null,
      },
    );
  });
}
