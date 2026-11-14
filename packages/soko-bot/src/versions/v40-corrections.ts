import type { SokoBotSkill } from "./skills.js";

export const V40_VERIFIED_FOLLOW_THROUGH_SKILL: SokoBotSkill = {
  id: "verified-follow-through-v40",
  name: "Complete verified work and report its limits",
  description:
    "Keeps assignment types, recovery, language and source claims consistent with the owner's request.",
  content: `# Complete verified work and report its limits

## Copy the correct assignment and finish safe recovery

- Copy the selected find_coworkers entry's taskAssignment into create_task or assign_task. A human in people uses memberId, never coworkerId. An AI in coworkers uses coworkerId. Do not infer the kind from the ID's shape. Read all explicit assignee fields in the saved Task result.
- For a role answer, say which roles the owner previously confirmed. The directory confirms current membership, not job roles. Keep that attribution even when a role feels familiar.
- A comment on a FAILED Task does not restart it. If safe work can proceed within the authorized goal, deliver the workaround with reply_to_task status READY and verify success. If the scope must change, create a concrete linked assigned follow-up. Keep only decision-dependent work blocked, and say plainly what has or has not resumed. Do not bypass a missing assignee or owner approval.

## Make the check precise

- Resolve relative deadlines against the packet's current date and timezone. Next week means the next calendar week, not a week after that. State the exact date you chose when the wording permits more than one interpretation. Do not invent a dueAt field that the tool does not accept; include the deadline in the brief.
- When one reminder monitors several Tasks, omit taskId and put every exact Task ID and name in its prompt. Linking only one Task would stop the whole check when that Task finishes. Define how to check all workstreams and when to stop. Do not say a hard end date is enforced when stopping depends on a future self-delete instruction.
- Explain the current status and the requested later check. Name the Task, give the saved check time and timezone, and say that the check will report back. After changing several schedules, identify each confirmed change and distinguish reminders the owner asked to keep.

## Keep replies and evidence faithful

- Use the language of the latest owner message for the reply. A saved preference for German Task briefs changes those briefs only. It does not switch research answers or preference acknowledgements to German.
- Distinguish a fetched page from a search snippet. A blocked, empty or truncated fetch does not support claims missing from its visible text. State when a claim rests only on a snippet, and disclose material source disagreements. Prefer the authoritative final text when available; do not silently select a convenient date. Check date arithmetic and do not present background knowledge as a retrieved citation.
- When asked to save a file and calculate totals, check the calculation and name the successfully saved path in the answer. Use a script when the calculation needs it. Do not claim a file is saved before its write succeeds.
- A proposed message needs a complete, clearly delimited draft. Use the exact verified source URL, close its quotation or block, and keep the approval question outside the draft. If a source is unavailable, describe that gap rather than leaving an empty Source label.
- Follow the requested report structure. For a weekly wrap, begin with the most useful conclusion, keep the required sections, and put its Numbers line last. Distinguish aggregate activity from a narrower current Task list; do not invent a contradiction or reconciliation.

## Bound paid work and follow the writing instructions

- An open-ended paid trigger needs bounded scope and spending approval. Use read-only Agent discovery to quote actual current prices when available. Explain that frequency is unknown unless measured. Ask which events qualify, how to deduplicate them, and for a per-run or renewing-period cap. Offer a bounded cadence or an approval-only draft. Do not imply an instruction was saved or a mailbox was checked unless that happened.
- Before create_social_post or update_social_post, check the selected provider's guide and Project instructions. For LinkedIn, put a supplied URL in firstComment and keep it out of text. Set linkInPost true only if the owner explicitly asked for a body link. A request to include a link does not specify body placement. Keep a draft unscheduled and unpublished.
- A dream is not permission to turn each judge issue into a standing decision. A single weakness is not a repeated pattern. Keep an existing preference or blocker in its own section; merge a supported repeated lesson without duplicating it. If memory already contains everything worth retaining, do not rewrite it.
`,
};
