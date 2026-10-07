import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus, TaskVisibility } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { buildHumanTaskVisibilityWhere } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  TASK_AWAITING_INPUT_STATUSES,
  taskSummaryResponseSchema,
} from "@/schemas/task.schema";

/** The one reporting window. The 24h before it is the trend baseline. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

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
    "Counts for the /chat landing over the last 24h, plus the 24h before it (`previous`) for a trend arrow. `awaitingInput` is point-in-time and has no previous value. Interactive session users only — not coworker tokens.",
  tags: ["Tasks"],
  request: { query },
  responses: {
    200: jsonSuccessResponse(
      taskSummaryResponseSchema,
      "Task activity summary for the active workspace",
      {
        data: {
          since: "2026-08-10T12:00:00.000Z",
          completed: 4,
          awaitingInput: 2,
          createdByOtherHumans: 3,
          workedMinutes: 47,
          previous: {
            completed: 3,
            createdByOtherHumans: 5,
            workedMinutes: 60,
          },
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

    const now = new Date();
    const sinceDate = new Date(now.getTime() - WINDOW_MS);
    const prevStart = new Date(now.getTime() - 2 * WINDOW_MS);
    const base = {
      archivedAt: null,
      workspaceId: workspaceContext.workspaceId,
      ...(scope === "owned" ? { ownerId: userContext.userId } : {}),
      ...buildHumanTaskVisibilityWhere(userContext.userId),
    };
    const range = (from: Date, to: Date) => ({ gte: from, lt: to });

    // Time in progress, reconstructed from status-transition events: each
    // RUNNING event is paired with whatever event superseded it. There is no
    // duration column anywhere, and elapsed created→completed would count
    // nights and weekends a task merely sat around waiting.
    const ownerFilter =
      scope === "owned"
        ? PrismaRaw.sql`AND t."ownerId" = ${userContext.userId}`
        : PrismaRaw.empty;
    const visibilityFilter = PrismaRaw.sql`
      AND (
        t.visibility = ${TaskVisibility.PUBLIC}::"TaskVisibility"
        OR (
          t.visibility = ${TaskVisibility.PRIVATE}::"TaskVisibility"
          AND t."ownerId" = ${userContext.userId}
        )
      )
    `;

    // Task has no completedAt column, so the last write stands in for the
    // completion time. A COMPLETED task is terminal, so in practice its final
    // update is the completion itself.
    const completedIn = (from: Date, to: Date) =>
      prisma.task.count({
        where: {
          ...base,
          status: TaskStatus.COMPLETED,
          updatedAt: range(from, to),
        },
      });

    // Only an organization workspace has other humans in it. Honours `scope`
    // via `base`: under `owned` this is "tasks I own that a teammate created".
    const byOthersIn = (from: Date, to: Date) =>
      workspaceContext.organizationId
        ? prisma.task.count({
            where: {
              ...base,
              creatorUserId: { not: userContext.userId },
              NOT: { creatorUserId: null },
              createdAt: range(from, to),
            },
          })
        : Promise.resolve(0);

    // Minutes in RUNNING within [from, to), clipped to those bounds.
    const workedMinutesIn = async (from: Date, to: Date) => {
      const rows = await prisma.$queryRaw<{ seconds: number | null }[]>`
        SELECT COALESCE(
                 SUM(
                   EXTRACT(EPOCH FROM (
                     LEAST(COALESCE(s.next_at, now()), ${to})
                     - GREATEST(s.started_at, ${from})
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
              AND e."createdAt" >= ${from}
              AND e."createdAt" < ${to}
            UNION ALL
            -- Plus the last transition before the window — the only earlier
            -- event that can still be in force at the window start, and so the
            -- only one that can open a span crossing into it.
            (
              SELECT e."taskId", e."createdAt", e.status
              FROM "taskEvent" e
              WHERE e."taskId" = t.id
                AND e.status IS NOT NULL
                AND e."createdAt" < ${from}
              ORDER BY e."createdAt" DESC
              LIMIT 1
            )
          ) ev
          WHERE t."archivedAt" IS NULL
            AND t."workspaceId" = ${workspaceContext.workspaceId}
            ${ownerFilter}
            ${visibilityFilter}
            -- Skip tasks that cannot contribute a RUNNING span in/after the
            -- window: still-running, recently written, or with a status event
            -- inside the window. Avoids lateral work over the full archive.
            AND (
              t.status = ${TaskStatus.RUNNING}::"TaskStatus"
              OR t."updatedAt" >= ${from}
              OR EXISTS (
                SELECT 1
                FROM "taskEvent" e
                WHERE e."taskId" = t.id
                  AND e.status IS NOT NULL
                  AND e."createdAt" >= ${from}
                  AND e."createdAt" < ${to}
              )
            )
        ) s
        -- Overlap, not containment: a run that began before the window still
        -- did work inside it, and GREATEST/LEAST clip the parts outside so no
        -- run can report more minutes than the window holds. COALESCE keeps a
        -- still-open run counting up to now.
        WHERE s.status = ${TaskStatus.RUNNING}::"TaskStatus"
          AND s.started_at < ${to}
          AND COALESCE(s.next_at, now()) > ${from}
      `;
      return Math.max(0, Math.round(Number(rows[0]?.seconds ?? 0) / 60));
    };

    const [
      completed,
      awaitingInput,
      createdByOtherHumans,
      workedMinutes,
      previousCompleted,
      previousCreatedByOtherHumans,
      previousWorkedMinutes,
    ] = await Promise.all([
      completedIn(sinceDate, now),
      prisma.task.count({
        where: {
          ...base,
          // Point-in-time: "waiting on you right now", so the window does not
          // apply. Something blocked since last month still needs answering.
          // No previous value: past backlog is not derivable without history.
          status: { in: [...TASK_AWAITING_INPUT_STATUSES] },
        },
      }),
      byOthersIn(sinceDate, now),
      workedMinutesIn(sinceDate, now),
      completedIn(prevStart, sinceDate),
      byOthersIn(prevStart, sinceDate),
      workedMinutesIn(prevStart, sinceDate),
    ]);

    return ok(
      c,
      taskSummaryResponseSchema.parse({
        since: sinceDate,
        completed,
        awaitingInput,
        createdByOtherHumans,
        workedMinutes,
        previous: {
          completed: previousCompleted,
          createdByOtherHumans: previousCreatedByOtherHumans,
          workedMinutes: previousWorkedMinutes,
        },
      }),
    );
  });
}
