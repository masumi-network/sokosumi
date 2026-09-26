import { TaskScheduleState, TaskStatus } from "@sokosumi/database";
import type { Next } from "hono";

import { createPaginationMeta } from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { requireUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { listTaskSchedules } from "@/services/task-schedule.service";

import {
  legacySeriesView,
  legacyTaskIds,
  legacyTaskView,
  withLegacyOnceFieldsOnData,
} from "./series";
import {
  type LegacyContext,
  legacyScheduleVendor,
  logLegacyScheduleHit,
  rewriteData,
} from "./vendor";

/** Every live schedule the caller reads in the workspace, one-time Tasks too. */
async function listLegacyScheduled(c: LegacyContext) {
  const schedules = [];
  let cursor: string | undefined;
  do {
    const page = await listTaskSchedules(c.var, { cursor, limit: 100 });
    schedules.push(...page.schedules);
    cursor = page.pagination.nextCursor ?? undefined;
  } while (cursor);
  const live = schedules.filter(
    (schedule) => schedule.state !== TaskScheduleState.ENDED,
  );
  const legacyIds = await legacyTaskIds(live);
  const { userId } = requireUserContext(c.var.authContext);
  const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
  const oneTime = await prisma.task.findMany({
    where: {
      workspaceId,
      ownerId: userId,
      status: TaskStatus.QUEUED,
      runAt: { not: null },
      archivedAt: null,
    },
  });
  return [
    ...live.map((schedule) =>
      legacySeriesView(schedule, legacyIds.get(schedule.id) ?? schedule.id),
    ),
    ...oneTime.map(legacyTaskView),
  ];
}

/**
 * `GET /v1/tasks`: `sort=nextRunAt` was how these clients listed their
 * schedules, as Tasks with `metadata` and `nextRunAt`. Any other list adds
 * those fields to one-time Tasks.
 */
export async function listLegacyTasks(c: LegacyContext, next: Next) {
  if (c.req.method !== "GET" || !legacyScheduleVendor(c.var.authContext)) {
    return next();
  }
  if (c.req.query("sort") !== "nextRunAt") {
    await next();
    await rewriteData(c, withLegacyOnceFieldsOnData);
    return;
  }
  logLegacyScheduleHit(
    c,
    "/v1/tasks?sort=nextRunAt",
    "GET /v1/tasks/schedules",
  );
  const views = await listLegacyScheduled(c);
  return ok(
    c,
    views,
    createPaginationMeta(views, views.length, views.length, false, undefined),
  );
}
