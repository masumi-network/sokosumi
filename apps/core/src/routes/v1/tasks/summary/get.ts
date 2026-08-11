import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  TASK_AWAITING_INPUT_STATUSES,
  taskSummaryResponseSchema,
} from "@/schemas/task.schema";

/** Below this, "since your last visit" covers nothing worth reporting. */
const MIN_MEANINGFUL_WINDOW_MS = 30 * 60 * 1000;

/** Rolling fallback window when the last visit was only moments ago. */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

const query = z.object({
  scope: z
    .enum(["owned", "workspace"])
    .default("owned")
    .openapi({
      param: { name: "scope", in: "query" },
      description:
        "`owned` counts only the caller's own tasks; `workspace` counts every task in the active workspace.",
    }),
});

const route = createRoute({
  method: "get",
  path: "/summary",
  description:
    "Counts for the /chat landing: how much finished while the user was away, how much is blocked on them, and how much their human teammates added. The window is the caller's stored `lastSeenAt` (null on a first visit means all-time), read here rather than supplied by the client so a stale session cookie cannot skew it. Session users only.",
  tags: ["Tasks"],
  request: { query },
  responses: {
    200: jsonSuccessResponse(
      taskSummaryResponseSchema,
      "Task activity summary for the active workspace",
      {
        data: {
          since: "2026-08-10T09:00:00.000Z",
          completed: 4,
          awaitingInput: 2,
          createdByOtherHumans: 3,
        },
        meta: {
          timestamp: "2026-08-11T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // Owner context only. requireUserContext also admits a coworker token that
    // carries user context, which would hand a vendor the workspace's activity.
    const userContext = requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { scope } = c.req.valid("query");

    const caller = await prisma.user.findUnique({
      where: { id: userContext.userId },
      select: { lastSeenAt: true },
    });

    // A visit recorded seconds ago produces a window nothing can fall into, so
    // the page would go blank the moment the user reloaded or came back from a
    // room. Fall back to a rolling day so there is always something true to
    // show, and tell the client which window it got so the caption matches.
    const lastSeenAt = caller?.lastSeenAt ?? null;
    const elapsedMs = lastSeenAt ? Date.now() - lastSeenAt.getTime() : null;
    const useLastVisit =
      lastSeenAt !== null &&
      elapsedMs !== null &&
      elapsedMs >= MIN_MEANINGFUL_WINDOW_MS;
    const basis = useLastVisit ? "lastVisit" : "recent";
    const sinceDate = useLastVisit
      ? lastSeenAt
      : new Date(Date.now() - RECENT_WINDOW_MS);
    const workspaceWhere = {
      archivedAt: null,
      workspaceId: workspaceContext.workspaceId,
    };
    const ownerWhere = scope === "owned" ? { ownerId: userContext.userId } : {};
    const withinWindow = sinceDate ? { updatedAt: { gte: sinceDate } } : {};

    // Time in progress, reconstructed from status-transition events: each
    // RUNNING event is paired with whatever event superseded it. There is no
    // duration column anywhere, and elapsed created→completed would count
    // nights and weekends a task merely sat around waiting.
    const ownerFilter =
      scope === "owned"
        ? PrismaRaw.sql`AND t."ownerId" = ${userContext.userId}`
        : PrismaRaw.empty;

    const [completed, awaitingInput, createdByOtherHumans, workedRows] =
      await Promise.all([
        prisma.task.count({
          where: {
            ...workspaceWhere,
            ...ownerWhere,
            status: TaskStatus.COMPLETED,
            // Task has no completedAt column, so the last write stands in for the
            // completion time. A COMPLETED task is terminal, so in practice its
            // final update is the completion itself.
            ...withinWindow,
          },
        }),
        prisma.task.count({
          where: {
            ...workspaceWhere,
            ...ownerWhere,
            // Point-in-time: "waiting on you right now", so the window does not
            // apply. Something blocked since last month still needs answering.
            status: { in: [...TASK_AWAITING_INPUT_STATUSES] },
          },
        }),
        // Only an organization workspace has other humans in it.
        workspaceContext.organizationId
          ? prisma.task.count({
              where: {
                ...workspaceWhere,
                // Honour `scope` like every other counter here. Under `owned`
                // this narrows to "tasks I own that a teammate created";
                // under `workspace` it is a no-op.
                ...ownerWhere,
                creatorUserId: { not: userContext.userId },
                NOT: { creatorUserId: null },
                ...(sinceDate ? { createdAt: { gte: sinceDate } } : {}),
              },
            })
          : Promise.resolve(0),
        prisma.$queryRaw<{ seconds: number | null }[]>`
        SELECT COALESCE(
                 SUM(
                   EXTRACT(EPOCH FROM (
                     COALESCE(s.next_at, now())
                     - GREATEST(s.started_at, ${sinceDate})
                   ))
                 ),
                 0
               )::double precision AS seconds
        FROM (
          SELECT ev."createdAt" AS started_at,
                 ev.status,
                 LEAD(ev."createdAt") OVER (
                   PARTITION BY ev."taskId" ORDER BY ev."createdAt"
                 ) AS next_at
          FROM "task" t
          -- Per task, read only the events that can bear on the window rather
          -- than its whole history: without this the landing page sorted every
          -- status event the workspace had ever recorded, on every load.
          CROSS JOIN LATERAL (
            SELECT e."taskId", e."createdAt", e.status
            FROM "taskEvent" e
            WHERE e."taskId" = t.id
              -- Only status transitions close a span. Progress comments are
              -- written with a NULL status, and letting one win the LEAD cut
              -- every run short at its first comment.
              AND e.status IS NOT NULL
              AND e."createdAt" >= ${sinceDate}
            UNION ALL
            -- Plus the last transition before the window — the only earlier
            -- event that can still be in force at the window start, and so the
            -- only one that can open a span crossing into it.
            (
              SELECT e."taskId", e."createdAt", e.status
              FROM "taskEvent" e
              WHERE e."taskId" = t.id
                AND e.status IS NOT NULL
                AND e."createdAt" < ${sinceDate}
              ORDER BY e."createdAt" DESC
              LIMIT 1
            )
          ) ev
          WHERE t."archivedAt" IS NULL
            AND t."workspaceId" = ${workspaceContext.workspaceId}
            ${ownerFilter}
        ) s
        -- Overlap, not containment: a run that began before the window still
        -- did work inside it, and GREATEST clips the part that predates the
        -- window so no run can report more minutes than the window holds.
        -- COALESCE keeps a still-open run counting up to now.
        WHERE s.status = ${TaskStatus.RUNNING}::"TaskStatus"
          AND COALESCE(s.next_at, now()) > ${sinceDate}
      `,
      ]);

    const workedSeconds = Number(workedRows[0]?.seconds ?? 0);

    return ok(
      c,
      taskSummaryResponseSchema.parse({
        basis,
        // dateTimeSchema serialises Date itself.
        lastVisitAt: lastSeenAt,
        since: sinceDate,
        completed,
        awaitingInput,
        createdByOtherHumans,
        workedMinutes: Math.max(0, Math.round(workedSeconds / 60)),
      }),
    );
  });
}
