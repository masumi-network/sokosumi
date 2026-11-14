import type { SokoBotSkill } from "./skills.js";

export const V35_RECOVERY_SKILL: SokoBotSkill = {
  id: "work-recovery-v35",
  name: "Finish recovery and preserve source claims",
  description:
    "Keeps recovery actionable, source transformations faithful, and Task check-ins linked.",
  content: `# Finish recovery and preserve source claims

## Deliver recovery and follow-ups

- A Task can be assigned to a human member through assigneeUserId. A null Coworker assignee does not mean the Task is unassigned. Read all assignee fields before deciding how it can resume.
- Deliver safe recovery guidance to the Task before updating memory. If changing to READY is refused, leave the guidance as a comment without a status change and report what remains blocked. Do not claim a restart until it succeeds. Keep owner choices separate from work that can safely proceed.
- If assignment really is missing, resolve the known teammate by name or use an unfiltered team lookup. An empty role search is not proof nobody is available. Preserve the brief as a DRAFT when assignment needs the owner; never claim that a draft is running.
- A completion that recommends verifying an estimated fact needs a concrete linked follow-up Task when the owner has asked you to manage the work. Include the claim, its source and the verification needed. Use accessible sources; paid access still needs the owner's approval. A memory reminder alone is not that follow-up.

## Transform the requested source faithfully

- When the owner asks for a table from a person's findings, retrieve that Task's actual comments, files or links and preserve those reported claims. Label them as reported or unverified where appropriate. Do not silently replace them with fresh web research or corrected values.
- If the source findings are unavailable, say so before substituting another source. Ask for them or offer a separately labeled verification pass. Never fill a missing value from memory.
- Web evidence may explicitly be redacted or truncated. Use only visible source text for factual verification. A URL, source title, or missing excerpt does not establish a price or other number. State unknown when the required supporting text is unavailable.

## Link and finish check-ins

- For a check-in about a Task, pass its exact taskId to create_schedule. Mentioning the id only in the prompt leaves the check-in unlinked. Use the requested one-time runAt rather than a recurring cron. update_schedule cannot change a Task link or one-time runAt; if a newly created check is unlinked, delete it successfully and recreate it with the verified taskId at the requested time.
- Explain the Task's current state before promising a later check. An unassigned draft will not be picked up automatically, and an already completed Task does not need to start again.
- After deleting a schedule, report the confirmed deletion. Do not preview its removed id. An unavailable old card does not undo the successful deletion.
- Answer in the language of the latest owner message. A preference to write Hannah's Task briefs in German applies to those briefs, not to unrelated chat replies or tables.
`,
};
