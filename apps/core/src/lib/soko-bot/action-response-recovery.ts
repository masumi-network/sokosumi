import type { SokoBotToolCall } from "@sokosumi/database";
import { canonicalActionJson } from "./action-receipts";

type RecoveryCall = Pick<
  SokoBotToolCall,
  "capability" | "input" | "status" | "disposition" | "targetId" | "errorDetail"
>;
const MISSING_PROJECT = "Project not found";
const UNASSIGNED_TABLE_TASK = "Task is not assigned to this actor";

/** Whether `later` repeats every field `earlier` set, with the same value. */
/**
 * What a file's name is chosen by. A voice-over refused because its filename
 * was taken, then made again under a new name, read "Not confirmed: made
 * voice-over." beneath the finished video.
 */
const FILE_NAMING_KEYS = new Set(["filename", "overwrite"]);

export function inputCovers(later: unknown, earlier: unknown): boolean {
  if (!isPlainObject(later) || !isPlainObject(earlier)) return false;
  return Object.entries(earlier).every(
    ([key, value]) =>
      FILE_NAMING_KEYS.has(key) ||
      JSON.stringify(later[key]) === JSON.stringify(value),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Load the requester only for the specific typed-ID mistake this can prove. */
export function requiresRecoveryRequester(call: RecoveryCall): boolean {
  return (
    call.capability === "create_task" && call.errorDetail === MISSING_PROJECT
  );
}

/** A validated create can replace a rejected request with one invalid scope field removed. */
export function correctedCreationInput(
  failed: RecoveryCall,
  applied: RecoveryCall,
  requesterId: string | null | undefined,
): boolean {
  if (
    failed.status !== "FAILED" ||
    failed.disposition !== "REJECTED" ||
    failed.targetId !== null ||
    !isPlainObject(failed.input) ||
    !isPlainObject(applied.input)
  )
    return false;
  const before = failed.input;
  const after = applied.input;
  let removedField: string;
  if (
    requiresRecoveryRequester(failed) &&
    requesterId &&
    before.projectId === requesterId &&
    typeof before.name === "string" &&
    before.name.length > 0 &&
    typeof before.description === "string" &&
    before.description.length > 0
  ) {
    // A user ID is not an intended Project. Other missing or inaccessible Projects stay visible.
    removedField = "projectId";
  } else if (
    failed.capability === "create_table" &&
    failed.errorDetail === UNASSIGNED_TABLE_TASK &&
    typeof before.key === "string" &&
    before.key.length > 0 &&
    before.key === after.key &&
    typeof before.taskId === "string" &&
    before.taskId.length > 0
  ) {
    removedField = "taskId";
  } else return false;
  if (after[removedField] !== undefined) return false;
  const corrected = Object.fromEntries(
    Object.entries(before).filter(([key]) => key !== removedField),
  );
  return canonicalActionJson(corrected) === canonicalActionJson(after);
}
