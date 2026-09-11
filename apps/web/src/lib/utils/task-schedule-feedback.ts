import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

/**
 * The stable Core error kinds a Task mutation reports back to its caller as a
 * result instead of throwing. They are a Core-contract concept, so they live
 * beside the copy they map to rather than in the server action that returns
 * them; `@/lib/actions/task/action` imports this list.
 */
export const TASK_MUTATION_ERROR_KINDS = [
  CORE_API_ERROR_KINDS.CALENDAR_CLIENT_UPGRADE_REQUIRED,
  CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT,
  CORE_API_ERROR_KINDS.SCHEDULE_QUARANTINED,
  CORE_API_ERROR_KINDS.SCHEDULE_ACTIVE,
  CORE_API_ERROR_KINDS.IDEMPOTENCY_CONFLICT,
  CORE_API_ERROR_KINDS.SCHEDULE_OCCURRENCE_NOT_RESCHEDULABLE,
  CORE_API_ERROR_KINDS.SCHEDULE_OCCURRENCE_TARGET_INVALID,
  CORE_API_ERROR_KINDS.SCHEDULE_CURSOR_STALE,
] as const;

export type TaskMutationErrorKind = (typeof TASK_MUTATION_ERROR_KINDS)[number];

export type TaskScheduleSeriesFeedbackKey =
  | "revisionConflict"
  | "quarantined"
  | "operationConflict"
  | "activeSeries"
  | "occurrenceLocked"
  | "occurrenceTargetInvalid";

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
  schedule_occurrence_not_reschedulable: "occurrenceLocked",
  schedule_occurrence_target_invalid: "occurrenceTargetInvalid",
  // A cursor minted at an older revision describes a series that has moved on,
  // exactly like a revision conflict: the recovery is to reload and retry.
  schedule_cursor_stale: "revisionConflict",
};

export function taskScheduleSeriesFeedbackKey(
  kind: TaskMutationErrorKind,
): TaskScheduleSeriesFeedbackKey | null {
  return SERIES_FEEDBACK_KEY[kind];
}
