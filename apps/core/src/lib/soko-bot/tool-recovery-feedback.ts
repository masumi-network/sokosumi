import { z } from "zod";

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

/** Clarify a successful tool result without changing its facts or authority. */
export function toolRecoveryFeedback(
  capability: string,
  result: unknown,
): unknown {
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
    if (saved.success)
      return {
        ...saved.data,
        instruction:
          "This schedule was saved without a linked Task. If the owner's request monitors a Task, delete this unlinked check and use create_schedule with the verified taskId and requested runAt. update_schedule cannot change a Task link or one-time runAt. Verify the deletion before recreating the check. Mentioning the Task only in the prompt does not link it. Ordinary reminders need no Task link.",
      };
  }
  return result;
}
