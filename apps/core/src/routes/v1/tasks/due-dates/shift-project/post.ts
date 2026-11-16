import { createRoute, z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

import { buildTaskWriteAccessWhere } from "@/helpers/access-control";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { buildHumanTaskVisibilityWhere } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";

import {
  dueDayString,
  eachLockedTask,
  MAX_DUE_DATE_MOVES,
  NOT_MOVABLE,
} from "../each-locked-task";

const DAY_MS = 86_400_000;
const MAX_SHIFT_DAYS = 365;

const requestSchema = z
  .object({
    projectId: z.uuid(),
    days: z
      .number()
      .int()
      .min(-MAX_SHIFT_DAYS)
      .max(MAX_SHIFT_DAYS)
      .refine((days) => days !== 0, { message: "days must not be 0" })
      .openapi({
        description:
          "Days to move every due date by: positive is later, negative earlier.",
        example: 7,
      }),
    preview: z.boolean().optional().openapi({
      description: "Return what would move, and change nothing.",
    }),
  })
  .openapi("ShiftProjectDueDatesRequest");

const shiftedTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  from: z.string().openapi({ example: "2026-11-20" }),
  to: z.string().openapi({ example: "2026-11-27" }),
});

const responseSchema = z
  .object({
    tasks: z.array(shiftedTaskSchema).openapi({
      description: `Tasks moved, or on a preview the Tasks that would move (earliest first, at most ${MAX_DUE_DATE_MOVES}).`,
    }),
    total: z.number().int().openapi({
      description: "Every Task the move covers, even past the preview's list.",
    }),
    skipped: z.number().int().openapi({
      description:
        "Tasks that changed meanwhile, could not be edited or failed, and kept their due day.",
    }),
  })
  .openapi("ShiftProjectDueDates");

const route = createRoute({
  method: "post",
  path: "/due-dates/shift-project",
  description: `Move the due date of every open Task in a project by the same number of days, so their spacing stays. Covers Tasks in the active workspace the caller may edit, with a due date, not finished, cancelled, archived or waiting on a grant. A project with more than ${MAX_DUE_DATE_MOVES} such Tasks is refused rather than half moved. Each Task is checked again under lock and moves only from the day it was picked on.`,
  tags: ["Tasks"],
  request: {
    body: { content: { "application/json": { schema: requestSchema } } },
  },
  responses: {
    200: jsonSuccessResponse(responseSchema, "Moved project due dates"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

function shifted(day: Date, days: number): Date {
  return new Date(day.getTime() + days * DAY_MS);
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { projectId, days, preview } = c.req.valid("json");
    const where: Prisma.TaskWhereInput = {
      workspaceId,
      projectId,
      archivedAt: null,
      dueOn: { not: null },
      status: { notIn: NOT_MOVABLE },
      AND: [
        buildHumanTaskVisibilityWhere(userContext.userId),
        buildTaskWriteAccessWhere(userContext.userId),
      ],
    };

    const [candidates, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: [{ dueOn: "asc" }, { id: "asc" }],
        take: MAX_DUE_DATE_MOVES,
        select: { id: true, name: true, dueOn: true },
      }),
      prisma.task.count({ where }),
    ]);
    const planned = candidates.flatMap((task) =>
      task.dueOn ? [{ id: task.id, name: task.name, from: task.dueOn }] : [],
    );
    const describe = (task: (typeof planned)[number]) => ({
      id: task.id,
      name: task.name,
      from: dueDayString(task.from),
      to: dueDayString(shifted(task.from, days)),
    });

    if (preview) {
      return ok(
        c,
        responseSchema.parse({
          tasks: planned.map(describe),
          total,
          skipped: 0,
        }),
      );
    }
    if (total > MAX_DUE_DATE_MOVES) {
      throw unprocessableEntity(
        `A project can move at most ${MAX_DUE_DATE_MOVES} due dates at once`,
      );
    }

    const byId = new Map(planned.map((task) => [task.id, task]));
    const { done, skipped } = await eachLockedTask(
      [...byId.keys()],
      { userContext, workspaceId },
      async (tx, task) => {
        const pick = byId.get(task.id);
        if (!pick) return null;
        // Every rule again, under lock, plus the picked day: a Task finished,
        // moved out of the project or re-dated meanwhile matches nothing.
        const { count } = await tx.task.updateMany({
          where: { AND: [where, { id: task.id, dueOn: pick.from }] },
          data: { dueOn: shifted(pick.from, days) },
        });
        return count === 1 ? describe(pick) : null;
      },
    );

    if (done.length > 0) await deliverCalendarInvalidationsNow(workspaceId);
    return ok(c, responseSchema.parse({ tasks: done, total, skipped }));
  });
}
