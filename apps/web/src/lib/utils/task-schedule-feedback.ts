import type { TaskMutationErrorKind } from "@/lib/actions/task/action";

export type TaskScheduleSeriesFeedbackKey =
  | "revisionConflict"
  | "quarantined"
  | "operationConflict"
  | "activeSeries";

/**
 * Message keys under `App.Tasks.Schedule.series`, one per stable Core kind a
 * series mutation can fail with. Every surface that edits or removes a series
 * shows the same recovery for the same kind, and none of them read the Core
 * message text.
 *
 * `calendar_client_upgrade_required` maps to `null`: it is a stale-client
 * state the app already answers with its reload modal, not with inline copy.
 */
const SERIES_FEEDBACK_KEY: Record<
  TaskMutationErrorKind,
  TaskScheduleSeriesFeedbackKey | null
> = {
  calendar_client_upgrade_required: null,
  schedule_revision_conflict: "revisionConflict",
  schedule_quarantined: "quarantined",
  idempotency_conflict: "operationConflict",
  schedule_active: "activeSeries",
};

export function taskScheduleSeriesFeedbackKey(
  kind: TaskMutationErrorKind,
): TaskScheduleSeriesFeedbackKey | null {
  return SERIES_FEEDBACK_KEY[kind];
}
