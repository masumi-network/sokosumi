import type { Next } from "hono";

import { ok } from "@/helpers/response";
import { getTaskSchedule } from "@/services/task-schedule.service";

import {
  legacySeriesView,
  resolveLegacySeries,
  withLegacyOnceFieldsOnData,
} from "./series";
import {
  type LegacyContext,
  legacyScheduleVendor,
  logLegacyScheduleHit,
  rewriteData,
} from "./vendor";

/**
 * `GET /v1/tasks/{id}`: an old template id reads as its schedule, and a
 * one-time Task gets `metadata` and `nextRunAt`.
 */
export async function getLegacyTask(c: LegacyContext, next: Next) {
  if (c.req.method !== "GET" || !legacyScheduleVendor(c.var.authContext)) {
    return next();
  }
  const id = c.req.param("id");
  const workspace = c.var.workspaceContext;
  const series =
    id && workspace
      ? await resolveLegacySeries(id, workspace.workspaceId)
      : null;
  if (!id || !series) {
    await next();
    await rewriteData(c, withLegacyOnceFieldsOnData);
    return;
  }
  logLegacyScheduleHit(c, "/v1/tasks/{id}", "GET /v1/tasks/schedules/{id}");
  return ok(c, legacySeriesView(await getTaskSchedule(c.var, series.id), id));
}
