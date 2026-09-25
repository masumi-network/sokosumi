import { TaskScheduleState } from "@sokosumi/database";
import type { Next } from "hono";

import { formatZodErrorMessage } from "@/helpers/error";
import { ok } from "@/helpers/response";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  changeTaskScheduleState,
  createTaskSchedule,
  getWritableTaskSchedule,
  resolveScheduleActor,
  updateTaskSchedule,
} from "@/services/task-schedule.service";

import {
  mapTaskBlueprintToCreate,
  requireTaskBlueprint,
  setLegacyRunAt,
} from "./blueprint";
import {
  isLegacyHold,
  legacyRuleMatches,
  legacyScheduleSchema,
  mapLegacyRuleToUpdate,
  NEW_CREATE,
  NEW_PATCH,
  NEW_TASK_CREATE,
} from "./rule";
import { legacySeriesView, resolveLegacySeries } from "./series";
import {
  type LegacyContext,
  legacyScheduleVendor,
  logLegacyScheduleHit,
  throwUnmappable,
} from "./vendor";

/**
 * `PUT /v1/tasks/{id}/schedule`: create, change, pause, and resume a
 * repeating job, or start a Task once, as the old per-Task API did.
 */
export async function putLegacySchedule(c: LegacyContext, next: Next) {
  if (c.req.method !== "PUT" || !legacyScheduleVendor(c.var.authContext)) {
    return next();
  }
  const taskId = c.req.param("id") ?? "";
  const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
  const series = await resolveLegacySeries(taskId, workspaceId);
  logLegacyScheduleHit(
    c,
    "/v1/tasks/{id}/schedule",
    series ? NEW_PATCH : NEW_CREATE,
  );
  const parsed = legacyScheduleSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    throwUnmappable(
      `${formatZodErrorMessage(parsed.error)}. Use ${NEW_CREATE} with a typed rule.`,
      NEW_CREATE,
    );
  }
  const body = parsed.data;

  if (body.mode === "once") {
    if (!series) {
      const actor = await resolveScheduleActor(c.var);
      return ok(c, await setLegacyRunAt(c.var, actor, taskId, body));
    }
    // The hold is how these clients paused.
    if (!isLegacyHold(body)) {
      throwUnmappable(
        `A repeating job cannot become a one-time job. Create a Task with runAt on ${NEW_TASK_CREATE}.`,
        NEW_TASK_CREATE,
      );
    }
    let schedule = await getWritableTaskSchedule(c.var, series.id);
    if (schedule.state === TaskScheduleState.ACTIVE) {
      schedule = await changeTaskScheduleState(c.var, series.id, "pause");
    }
    return ok(c, legacySeriesView(schedule, taskId));
  }

  if (series) {
    let schedule = await getWritableTaskSchedule(c.var, series.id);
    if (!legacyRuleMatches(schedule, body)) {
      schedule = await updateTaskSchedule(
        c.var,
        series.id,
        mapLegacyRuleToUpdate(body, schedule),
      );
    }
    // Re-sending the rule over the hold is how these clients resumed.
    if (schedule.state === TaskScheduleState.PAUSED) {
      schedule = await changeTaskScheduleState(c.var, series.id, "resume");
    }
    return ok(c, legacySeriesView(schedule, taskId));
  }

  const actor = await resolveScheduleActor(c.var);
  const task = await requireTaskBlueprint(actor, taskId);
  const created = await createTaskSchedule(
    c.var,
    mapTaskBlueprintToCreate(task, body),
  );
  return ok(c, legacySeriesView(created, taskId));
}
