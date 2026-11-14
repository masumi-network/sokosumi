import { z } from "zod";
import { newsletterIssueLink } from "./newsletter-issue-link";

const BOT_SCHEDULE_PREVIEW_KIND = "bot_schedule";
const NEWSLETTER_EDITOR_CAPABILITIES = new Set([
  "newsletter_draft_issue",
  "create_newsletter_issue",
  "update_newsletter_issue",
  "get_newsletter_issue",
]);
const newsletterIssue = z
  .object({ id: z.uuid(), projectId: z.uuid(), status: z.string() })
  .passthrough();

const directoryResult = z
  .object({
    people: z.array(z.unknown()),
    coworkers: z.array(z.unknown()),
  })
  .passthrough();
const directoryPerson = z.object({ userId: z.string().min(1) }).passthrough();
const directoryCoworker = z.object({ id: z.string().min(1) }).passthrough();
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
const assignedFailedTask = z
  .object({
    id: z.string().min(1),
    status: z.literal("FAILED"),
    assigneeUserId: z.string().min(1).nullable(),
    assigneeCoworkerId: z.string().min(1).nullable(),
    assigneeSokoBotId: z.string().min(1).nullable(),
  })
  .passthrough()
  .refine((task) =>
    Boolean(
      task.assigneeUserId || task.assigneeCoworkerId || task.assigneeSokoBotId,
    ),
  );

/** Clarify a successful tool result without changing its facts or authority. */
export function toolRecoveryFeedback(
  capability: string,
  result: unknown,
): unknown {
  if (NEWSLETTER_EDITOR_CAPABILITIES.has(capability)) {
    const issue = newsletterIssue.safeParse(result);
    if (issue.success)
      return {
        ...issue.data,
        url: newsletterIssueLink(
          issue.data,
          capability === "newsletter_draft_issue",
        ),
        instruction:
          "Present this issue editor URL as the review link. Do not call preview_result: newsletter issue IDs are not file or decision IDs and have no preview_result reference kind. Use get_newsletter_issue to read the saved issue. A preview card is not needed to link the draft. Keep the saved status; drafting does not submit, schedule or send it.",
      };
  }
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
    const failed = assignedFailedTask.safeParse(result);
    if (failed.success)
      return {
        ...failed.data,
        instruction:
          "This Task is FAILED and has a verified assignee. A comment alone does not restart it. If safe recovery can proceed within the owner's authorized scope, send the recovery guidance through reply_to_task with status READY, or create a linked assigned follow-up when the scope must change. Keep only work that depends on an unresolved owner choice blocked. If no safe recovery can proceed, keep it blocked and say why. Do not claim a restart until the status change succeeds; keep required progress checks active.",
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
    if (directory.success)
      return {
        ...directory.data,
        people: directory.data.people.map((entry) => {
          const person = directoryPerson.safeParse(entry);
          return person.success
            ? {
                ...person.data,
                taskAssignment: { memberId: person.data.userId },
              }
            : entry;
        }),
        coworkers: directory.data.coworkers.map((entry) => {
          const coworker = directoryCoworker.safeParse(entry);
          return coworker.success
            ? {
                ...coworker.data,
                taskAssignment: { coworkerId: coworker.data.id },
              }
            : entry;
        }),
        instruction:
          "Copy the selected entry's taskAssignment fields into create_task or assign_task. Human people use memberId; AI Coworkers use coworkerId. Do not put a human userId in coworkerId. Directory membership does not establish a person's job role; attribute owner-supplied roles to the owner.",
      };
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
            ? " This schedule was saved without a linked Task. If the owner's request monitors one Task, delete this unlinked check and use create_schedule with the verified taskId and requested runAt. update_schedule cannot change a Task link or one-time runAt. Verify the deletion before recreating the check. Mentioning the Task only in the prompt does not link it. For a group check, keep taskId omitted and include every verified Task ID in the prompt; linking only one Task would stop the whole check when that Task finishes. Ordinary reminders need no Task link."
            : ""),
      };
  }
  return result;
}
