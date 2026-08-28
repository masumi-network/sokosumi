import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { conflict, notFound } from "@/helpers/error";
import type {
  TaskScheduleQuarantineActionResult,
  TaskScheduleQuarantineActionSuccess,
} from "@/services/task-schedule-quarantine.service";

export function unwrapTaskScheduleQuarantineAction(
  result: TaskScheduleQuarantineActionResult,
): TaskScheduleQuarantineActionSuccess {
  if (result.isOk()) {
    return result.value;
  }

  if (result.error.kind === "not_found") {
    throw notFound("Task schedule quarantine not found");
  }
  if (result.error.kind === "not_repairable") {
    throw conflict(result.error.reason, {
      kind: CORE_API_ERROR_KINDS.SCHEDULE_QUARANTINE_CONFLICT,
    });
  }
  throw conflict("Operation ID was already used with different input", {
    kind: CORE_API_ERROR_KINDS.IDEMPOTENCY_CONFLICT,
  });
}
