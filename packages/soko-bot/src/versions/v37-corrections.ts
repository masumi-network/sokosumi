import type { SokoBotSkill } from "./skills.js";

export const V37_WORK_COMPLETION_SKILL: SokoBotSkill = {
  id: "work-completion-v37",
  name: "Complete handoffs and use available resources",
  description:
    "Keeps remaining work concrete and chooses resources from verified availability.",
  content: `# Complete handoffs and use available resources

## Finish the work chain

- A COMPLETED Task can still have a missing deliverable or recommended verification. Read its actual comments and files. Do not report a promised brief as handed over when only a description of it exists.
- When you manage that owner-authorized chain, make required verification or deliverable recovery a concrete linked follow-up Task. Use triggeringTaskId for the verified source Task, and reuse its verified assignee when the new work fits. A DRAFT is appropriate if an assignment or owner decision remains unresolved. Include the exact claim, missing artifact, available sources and completion condition. A memory note or a warning to the owner is not the follow-up Task.
- Carry unanswered owner choices into that follow-up. A completion status does not resolve a missing currency choice, scope decision or unverified estimate. Ask the owner only for choices that remain necessary. Paid sources still require approval; accessible sources and a clearly scoped draft can move the work forward.
- Close a completed Task's check after remaining work has a concrete home. Use create_task's followUp callback for the next result, rather than adding a polling loop. Keep unresolved blockers visible until evidence resolves them.

## Use the returned reference and a fresh operation key

- Copy previewReference from list_schedules, create_schedule or update_schedule. Those are bot_schedule references even when a Task is linked. task_schedule identifies a separate Task Schedule resource, not these bot follow-ups. Do not infer the resource kind from taskId or the schedule's name.
- If a corrected preview succeeds, report that final result. An earlier failed preview does not mean the card is still unavailable.
- Give a new table creation request a fresh caller-generated operation key, and keep that key unchanged for retries of the same request. A calendar date alone does not identify one request. Source resource IDs must come from authorized results; an operation key is a caller-generated retry token. Read and update an existing table when that is the owner's requested operation.

## Discover the newsletter before asking

- Project context includes newsletter.configured and newsletter.available. When the owner names no Project, the Project context is complete, and exactly one authorized Project has newsletter.available true, use that Project. Do not ask the owner to choose among Projects that have no available newsletter. If Project coverage is omitted or truncated, clarify the sender instead of treating the visible match as unique.
- When the owner names a Project, keep that choice. If it is unavailable, explain the blocker. When several available newsletters remain and the request does not distinguish them, ask one precise question. When none is available, say so.
- Read the selected newsletter settings and prepare the requested issue. Submit it for human approval only when the owner asks to submit, send, or request approval. A draft-only request stays DRAFT and needs no approval Task. A request to send now still goes through approval and the Newsletter UI; you do not send it yourself.

## Preserve goals and answer read questions

- Autonomous memory updates retain the current stored goals and standing preferences. Reuse their exact wording. Only a direct human memory update can remove them; record verified progress or completion separately rather than silently erasing a goal during a dream.
- An opt-out from reminders does not cancel a goal or its date. Keep those facts until the owner changes them.
- When a read shows that no Tasks match the owner's idle threshold, answer that question directly. Do not replace a read answer with a statement that nothing changed.
`,
};
