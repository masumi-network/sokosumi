import { TaskStatus } from "@sokosumi/database";
import type { Next } from "hono";

import prisma from "@/lib/db/prisma";

import { legacyTaskIds } from "./series";
import {
  type LegacyContext,
  legacyScheduleVendor,
  logLegacyScheduleHit,
  rewriteData,
} from "./vendor";

/**
 * `GET /v1/tasks/{id}/links`: these clients tell a scheduled run by a
 * `schedule_series` link to its Queued template, so a Run's Task gets one
 * to the id they know its schedule by.
 */
export async function getLegacyTaskLinks(c: LegacyContext, next: Next) {
  if (c.req.method !== "GET" || !legacyScheduleVendor(c.var.authContext)) {
    return next();
  }
  await next();
  const id = c.req.param("id");
  if (c.res.status !== 200 || !id) {
    return;
  }
  const task = await prisma.task.findUnique({
    where: { id },
    select: { schedule: true },
  });
  const schedule = task?.schedule;
  if (!schedule) {
    return;
  }
  const legacyId =
    (await legacyTaskIds([schedule])).get(schedule.id) ?? schedule.id;
  logLegacyScheduleHit(c, "/v1/tasks/{id}/links", "GET /v1/tasks/{id}");
  await rewriteData(c, (links) => [
    ...(Array.isArray(links) ? links : []),
    {
      id: schedule.id,
      createdAt: schedule.createdAt.toISOString(),
      updatedAt: schedule.updatedAt.toISOString(),
      relation: "schedule_series",
      // The old template stayed Queued between Runs.
      peerTask: {
        id: legacyId,
        name: schedule.name,
        status: TaskStatus.QUEUED,
        archivedAt: null,
      },
      note: null,
    },
  ]);
}
