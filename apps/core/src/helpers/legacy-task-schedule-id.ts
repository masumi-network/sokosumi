import { createHash } from "node:crypto";

/**
 * Temporary. Remove after 2026-09-29.
 *
 * Same formula as `pg_temp.cutover_id` in
 * `20260924130000_task_schedule_cutover`: RFC 9562 UUID v8 from md5 so a
 * template Task id still finds the Task Schedule the cutover minted.
 */
export function taskScheduleCutoverId(kind: string, sourceId: string): string {
  const digest = createHash("md5")
    .update(`task-schedule-cutover:${kind}:${sourceId}`)
    .digest("hex");
  const variantIndex = Number.parseInt(digest[16] ?? "0", 16) % 4;
  const variant = "89ab"[variantIndex] ?? "8";
  const hex = `${digest.slice(0, 12)}8${digest.slice(13, 16)}${variant}${digest.slice(17)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Schedule id the cutover assigned to a live template Task. */
export function migratedTaskScheduleId(templateTaskId: string): string {
  return taskScheduleCutoverId("schedule", templateTaskId);
}

/**
 * Create `operationId` of the schedule PUT /tasks/{id}/schedule makes from a
 * Task: its ledger row finds the schedule again and replays a retry.
 */
export function shimCreateOperationId(taskId: string): string {
  return taskScheduleCutoverId("legacy-shim", taskId);
}
