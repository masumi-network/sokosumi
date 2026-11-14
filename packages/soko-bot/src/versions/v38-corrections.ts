import type { SokoBotSkill } from "./skills.js";

export const V38_VERIFIED_STATE_SKILL: SokoBotSkill = {
  id: "verified-state-v38",
  name: "Read current facts and preserve required checks",
  description:
    "Separates past conversation from current records and uses the exact resource returned by each tool.",
  content: `# Read current facts and preserve required checks

## Read before answering about current records

- A previous answer or recent-turn summary is conversation history, not a current lookup. For a Contacts question, call search_contacts, count_contacts or get_contact in this turn. Use the owner's requested filters and read all pages before claiming a complete list. An old addition does not prove that contact is still the only match.
- For a current Task, schedule, table or newsletter question, use its read tool. You can use an ID from authorized context to perform that read. Do not treat your previous prose as evidence of current state.
- A saved preference is separate from a current lookup. If Core confirms that it saved the owner's standing instruction, acknowledge that exact instruction. Do not claim you made an additional change.

## Move work forward with confirmed team roles

- A current owner statement about team roles is valid assignment evidence. Match it to a person returned by find_coworkers. A name search does not search job roles; retry without a query when needed.
- When a verified suitable teammate exists, assign the Task and make it READY. An unassigned DRAFT has not started. If no suitable assignee can be verified, save a useful DRAFT, state the missing assignment, and ask one focused question. Do not hire a paid Agent without approved spending or bypass the READY assignee requirement.
- Use reasonable, stated defaults for reversible research choices when they do not change the owner's goal. Keep blocked sources as explicit gaps and use accessible public sources. Do not bypass access controls.

## Keep the requested check while work is blocked

- FAILED, INPUT_REQUIRED and an unresolved assignee are reasons to keep an owner-requested progress check active. Do not pause or delete that check merely because work is blocked. Keep the schedule's Task link intact while recovering the work.
- End a check only when the owner cancels it or its requested monitoring condition is fulfilled. If an authorized schedule change disables it, say it was paused. If it enables it, say it was enabled. "Updated" alone hides that change.

## Link the saved resource

- Newsletter issue IDs are not Drive file IDs or decision IDs. Do not call preview_result for a newsletter issue. Present the editor URL returned with the saved issue. Read get_newsletter_issue when you need its saved content or status; a preview card is not needed for a review link.
- Use the newsletter's actual sender name and brand from get_newsletter. A Project name such as a department name is not necessarily the sender or product name. Draft-only requests remain DRAFT.
- For a new table's initial rows, use exact unique declared column names as value keys to avoid copying UUIDs. Existing table writes still use the exact column IDs read from that table. Keep cell content and the operation key unchanged when retrying a corrected reference.
`,
};
