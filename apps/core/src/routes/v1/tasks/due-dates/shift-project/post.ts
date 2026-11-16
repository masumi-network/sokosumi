import { createRoute, z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

import { buildTaskWriteAccessWhere } from "@/helpers/access-control";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { buildHumanTaskVisibilityWhere } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";

import {
  dueDay,
  dueDaySchema,
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
    tasks: z
      .array(z.object({ id: z.string().min(1), from: dueDaySchema }))
      .min(1)
      .max(MAX_DUE_DATE_MOVES)
      .optional()
      .openapi({
        description:
          "The Tasks a preview showed, each with the due day it showed. Without it the route only previews.",
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
    skipped: z.number().int().openapi({
      description:
        "Confirmed Tasks that changed since the preview, are no longer eligible, could not be edited or failed, and kept their due day.",
    }),
    overLimit: z.boolean().openapi({
      description: `The preview found more than ${MAX_DUE_DATE_MOVES} Tasks; the project is too big to move at once.`,
    }),
  })
  .openapi("ShiftProjectDueDates");

const route = createRoute({
  method: "post",
  path: "/due-dates/shift-project",
  description: `Move the due date of every open Task in a project by the same number of days, so their spacing stays. Without \`tasks\` it previews: Tasks in the active workspace the caller may edit, with a due date, not finished, cancelled, archived or waiting on a grant, at most ${MAX_DUE_DATE_MOVES}. With \`tasks\` it moves exactly those, each checked again under lock and only from the day the preview showed, so a Task re-dated, added or finished since is never moved.`,
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

function describeShift(
  task: { id: string; name: string; from: Date },
  days: number,
) {
  return {
    id: task.id,
    name: task.name,
    from: dueDayString(task.from),
    to: dueDayString(new Date(task.from.getTime() + days * DAY_MS)),
  };
}

/** A Task a project move may re-date: open, dated, and the caller's to edit. */
export function shiftableTaskWhere(
  userId: string,
  workspaceId: string,
  projectId: string,
): Prisma.TaskWhereInput {
  return {
    workspaceId,
    projectId,
    archivedAt: null,
    dueOn: { not: null },
    status: { notIn: NOT_MOVABLE },
    AND: [
      buildHumanTaskVisibilityWhere(userId),
      buildTaskWriteAccessWhere(userId),
    ],
  };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { projectId, days, tasks: confirmed } = c.req.valid("json");
    const where = shiftableTaskWhere(
      userContext.userId,
      workspaceId,
      projectId,
    );

    if (!confirmed) {
      // One read, one past the limit: the list and whether the project is
      // over the limit come from the same snapshot.
      const picked = await prisma.task.findMany({
        where,
        orderBy: [{ dueOn: "asc" }, { id: "asc" }],
        take: MAX_DUE_DATE_MOVES + 1,
        select: { id: true, name: true, dueOn: true },
      });
      const tasks = picked
        .slice(0, MAX_DUE_DATE_MOVES)
        .flatMap(({ id, name, dueOn }) =>
          dueOn ? [describeShift({ id, name, from: dueOn }, days)] : [],
        );
      return ok(
        c,
        responseSchema.parse({
          tasks,
          skipped: 0,
          overLimit: picked.length > MAX_DUE_DATE_MOVES,
        }),
      );
    }

    const fromById = new Map(
      confirmed.map((task) => [task.id, dueDay(task.from)]),
    );
    const { done, skipped } = await eachLockedTask(
      [...fromById.keys()],
      { userContext, workspaceId },
      async (tx, task) => {
        const from = fromById.get(task.id);
        if (!from) return null;
        // Every rule again, under lock, plus the day the preview showed: a
        // Task finished, moved out of the project or re-dated since, or
        // already moved by a second Confirm, matches nothing.
        const { count } = await tx.task.updateMany({
          where: { AND: [where, { id: task.id, dueOn: from }] },
          data: { dueOn: new Date(from.getTime() + days * DAY_MS) },
        });
        return count === 1
          ? describeShift({ id: task.id, name: task.name, from }, days)
          : null;
      },
    );

    if (done.length > 0) await deliverCalendarInvalidationsNow(workspaceId);
    return ok(
      c,
      responseSchema.parse({ tasks: done, skipped, overLimit: false }),
    );
  });
}
