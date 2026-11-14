import { z } from "zod";

const BOT_SCHEDULE_PREVIEW_KIND = "bot_schedule";

const directoryResult = z
  .object({
    people: z.array(z.unknown()),
    coworkers: z.array(z.unknown()),
  })
  .passthrough();
const deletedSchedule = z
  .object({ id: z.string().min(1), deleted: z.literal(true) })
  .passthrough();
const unlinkedSchedule = z
  .object({ id: z.string().min(1), taskId: z.null() })
  .passthrough();
const botSchedule = z.object({ id: z.string().min(1) }).passthrough();
const unassignedTask = z
  .object({
    id: z.string().min(1),
    status: z.enum(["DRAFT", "INPUT_REQUIRED", "FAILED"]),
    assigneeUserId: z.null(),
    assigneeCoworkerId: z.null(),
    assigneeSokoBotId: z.null(),
  })
  .passthrough();
const completedTask = z
  .object({ id: z.string().min(1), status: z.literal("COMPLETED") })
  .passthrough();

/** Clarify a successful tool result without changing its facts or authority. */
export function toolRecoveryFeedback(
  capability: string,
  result: unknown,
): unknown {
  if (capability === "list_schedules" && Array.isArray(result))
    return result.map((entry) => {
      const schedule = botSchedule.safeParse(entry);
      return schedule.success
        ? {
            ...schedule.data,
            previewReference: {
              kind: BOT_SCHEDULE_PREVIEW_KIND,
              id: schedule.data.id,
            },
          }
        : entry;
    });
  if (capability === "get_task_status") {
    const task = unassignedTask.safeParse(result);
    if (task.success)
      return {
        ...task.data,
        instruction:
          "This Task has no assignee of any kind. Deliver answers or recovery guidance with reply_to_task without a status change. Do not request READY until an assignee is confirmed. Use assign_task only with a verified suitable assignee; ask the owner when that choice is unresolved.",
      };
    const completed = completedTask.safeParse(result);
    if (completed.success)
      return {
        ...completed.data,
        instruction:
          "COMPLETED is the Task status, not proof that every promised deliverable is attached or verified. Read its actual comments and files before claiming a handoff. When continuing an owner-authorized work chain, turn a recommended verification or missing deliverable into a concrete linked follow-up Task; use the existing assignee when verified and suitable. Do not clear unresolved goals or blockers merely because this Task completed. Paid access still requires approval.",
      };
  }
  if (capability === "find_coworkers") {
    const directory = directoryResult.safeParse(result);
    if (
      directory.success &&
      !directory.data.people.length &&
      !directory.data.coworkers.length
    ) {
      return {
        ...directory.data,
        instruction:
          "No directory entries matched. Human team search matches names or email, not job roles. Retry without a query, or resolve each person's name separately, before concluding nobody is available. Past Task assignments can describe past work, but do not establish a current general role.",
      };
    }
  }
  if (capability === "delete_schedule") {
    const deleted = deletedSchedule.safeParse(result);
    if (deleted.success) {
      return {
        ...deleted.data,
        instruction:
          "This schedule was deleted successfully. Its previous ID no longer has a preview. Report the confirmed deletion; do not call preview_result for this deleted schedule.",
      };
    }
  }
  if (capability === "create_schedule" || capability === "update_schedule") {
    const saved = unlinkedSchedule.safeParse(result);
    const schedule = botSchedule.safeParse(result);
    if (schedule.success)
      return {
        ...schedule.data,
        previewReference: {
          kind: BOT_SCHEDULE_PREVIEW_KIND,
          id: schedule.data.id,
        },
        instruction:
          "This is a bot_schedule, including when it monitors a Task. Copy previewReference when calling preview_result. task_schedule identifies a separate Task Schedule resource, not these bot follow-ups." +
          (saved.success
            ? " This schedule was saved without a linked Task. If the owner's request monitors a Task, delete this unlinked check and use create_schedule with the verified taskId and requested runAt. update_schedule cannot change a Task link or one-time runAt. Verify the deletion before recreating the check. Mentioning the Task only in the prompt does not link it. Ordinary reminders need no Task link."
            : ""),
      };
  }
  return result;
}
