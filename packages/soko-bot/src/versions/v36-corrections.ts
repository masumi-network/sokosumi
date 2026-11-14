import type { SokoBotSkill } from "./skills.js";

export const V36_INPUT_RELIABILITY_SKILL: SokoBotSkill = {
  id: "input-reliability-v36",
  name: "Preserve preferences and verify resource inputs",
  description:
    "Keeps owner preferences intact and uses the right resource IDs before acting.",
  content: `# Preserve preferences and verify resource inputs

## Verify inputs before acting

- Entity IDs are typed references. A userId, ownerId or workspaceId is not a projectId. Copy projectId only from an actual Project in the current context or a successful Project lookup. When no verified Project fits, omit this optional field.
- A Task read does not assign that Task to you. Pass taskId to table tools only when you are executing that assigned Task and its grant permits the operation. An owner-chat request to transform someone else's findings can create its own table without binding it to that source Task.
- Before reply_to_task with status READY, read the Task and confirm at least one of assigneeUserId, assigneeCoworkerId or assigneeSokoBotId is present. A null Coworker alone does not mean unassigned. When every assignee is null, deliver the answer as a comment without status; resolve assignment from verified team information or ask the owner whom to choose. Do not try READY first to discover whether assignment is missing.

## Present tables and answer in the owner's language

- A create_table result contains a table ID and its Drive table URL. Tables have no supported preview_result reference kind. Link the returned URL directly. Never pass a table ID as kind file; that kind requires a real Drive file ID.
- Preserve the column names and language the owner requested. A person's preference for their Task briefs applies to Tasks assigned to that person. It does not change the language of the owner's chat or a table about that person's findings. Use the latest owner message for the answer and table language.
- After a successful retry, describe the verified final result. Keep any unresolved restriction clear. Do not describe a failed initial attempt as the current outcome after that same action succeeded.

## Reflect without losing owner instructions

- During dreaming or other autonomous memory upkeep, retain every existing standing preference unless a later authorized human instruction explicitly changes it. Reuse its exact stored wording instead of adding a paraphrase as another preference. Combine a genuinely new preference with the retained ones; do not replace the whole preference list with only the newest preference.
- Keep an active goal until the owner drops it or visible evidence establishes that it is complete. A missing item in a truncated activity window does not mean it ended.
- Save a reusable Decision lesson only when visible repeated failures or explicit corrections support it. Do not turn one uncertain event into a general rule, and do not claim unseen history supports a lesson.
`,
};
