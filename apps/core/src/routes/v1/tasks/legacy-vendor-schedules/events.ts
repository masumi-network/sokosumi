import { randomUUID } from "node:crypto";

import { z } from "@hono/zod-openapi";
import { type TaskSchedule, TaskScheduleState } from "@sokosumi/database";
import type { Next } from "hono";

import prisma from "@/lib/db/prisma";
import type { CoworkerAuthenticationContext } from "@/middleware/auth";
import {
  changeTaskScheduleState,
  getWritableTaskSchedule,
} from "@/services/task-schedule.service";

import { resolveLegacySeries } from "./series";
import {
  type LegacyContext,
  legacyScheduleVendor,
  logLegacyScheduleHit,
  type RouteVars,
} from "./vendor";

/**
 * These clients post events with the Coworker key alone. The schedule is
 * changed as its owner, so the same Coworker checks as a delegated call
 * apply: capability, workspace grant, and write access to the schedule.
 */
function actingForOwner(
  vars: RouteVars,
  coworker: CoworkerAuthenticationContext,
  schedule: TaskSchedule,
): RouteVars {
  return {
    ...vars,
    authContext: {
      ...coworker,
      context: {
        userId: schedule.ownerId,
        organizationId: schedule.organizationId,
      },
    },
    workspaceContext: {
      workspaceId: schedule.workspaceId,
      organizationId: schedule.organizationId,
      userId: schedule.organizationId ? null : schedule.ownerId,
    },
  };
}

/** The workspace an id lives in: its Task's, or the schedule's it names. */
async function workspaceOf(id: string): Promise<string | null> {
  const task = await prisma.task.findUnique({
    where: { id },
    select: { workspaceId: true },
  });
  if (task) {
    return task.workspaceId;
  }
  if (!z.guid().safeParse(id).success) {
    return null;
  }
  const schedule = await prisma.taskSchedule.findUnique({
    where: { id },
    select: { workspaceId: true },
  });
  return schedule?.workspaceId ?? null;
}

const statusEventSchema = z.object({ status: z.enum(["READY", "CANCELED"]) });

/**
 * `POST /v1/tasks/{id}/events`: these clients canceled a schedule by moving
 * its template through READY to CANCELED. READY is accepted as a step and
 * CANCELED ends the schedule.
 */
export async function postLegacyTaskEvent(c: LegacyContext, next: Next) {
  const coworker = legacyScheduleVendor(c.var.authContext);
  if (c.req.method !== "POST" || !coworker) {
    return next();
  }
  const id = c.req.param("id");
  const event = statusEventSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  const workspaceId = id && event.success ? await workspaceOf(id) : null;
  const series =
    id && workspaceId ? await resolveLegacySeries(id, workspaceId) : null;
  if (!id || !event.success || !series) {
    return next();
  }
  logLegacyScheduleHit(
    c,
    "/v1/tasks/{id}/events",
    "POST /v1/tasks/schedules/{id}/end",
  );
  const vars = actingForOwner(c.var, coworker, series);
  if (
    event.data.status === "CANCELED" &&
    series.state !== TaskScheduleState.ENDED
  ) {
    await changeTaskScheduleState(vars, series.id, "end");
  } else {
    // A template never ran, so READY changes nothing but still needs access.
    await getWritableTaskSchedule(vars, series.id);
  }
  const now = new Date().toISOString();
  return c.json(
    {
      data: {
        id: randomUUID(),
        taskId: id,
        status: event.data.status,
        comment: null,
        coworkerId: coworker.coworkerId,
        createdAt: now,
        updatedAt: now,
      },
      meta: { timestamp: now, requestId: c.var.requestId },
    },
    201,
  );
}
