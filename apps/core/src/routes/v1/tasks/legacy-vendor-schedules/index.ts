import type { OpenAPIHonoWithAuth } from "@/lib/hono";

import { postLegacyTaskEvent } from "./events";
import { getLegacyTask } from "./get";
import { getLegacyTaskLinks } from "./links";
import { listLegacyTasks } from "./list";
import { putLegacySchedule } from "./put-schedule";

/**
 * Temporary vendor compatibility layer for the per-Task schedule API that
 * Task Schedules replaced (ADR 0041). Until it is removed, Coworkers of the
 * vendors in `LEGACY_TASK_SCHEDULE_VENDOR_IDS` read and write their
 * schedules through the old routes, translated to Task Schedules. Every
 * other caller passes straight through to the current routes.
 *
 * Each file is middleware in front of one route; none changes OpenAPI or a
 * route below it. To remove the layer: delete this directory and its mount
 * in `../index.ts`, then the `LEGACY_TASK_SCHEDULE_VENDOR_IDS` notes in
 * `apps/core/.env.example`, `apps/core/README.md`, and
 * `docs/coworker/vendor-workspace-grants-api.md`. In
 * `services/task-schedule.service.ts`, drop `getWritableTaskSchedule` and
 * make `resolveScheduleActor` and `ScheduleActor` private again.
 */
export default function mountLegacyVendorSchedules(app: OpenAPIHonoWithAuth) {
  app.use("/", listLegacyTasks);
  app.use("/:id", getLegacyTask);
  app.use("/:id/events", postLegacyTaskEvent);
  app.use("/:id/links", getLegacyTaskLinks);
  app.use("/:id/schedule", putLegacySchedule);
}
