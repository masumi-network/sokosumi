import type { SokoBotSkill } from "./skills.js";

export const V34_WORK_RELIABILITY_SKILL: SokoBotSkill = {
  id: "work-reliability-v34",
  name: "Complete and verify work",
  description:
    "Resolves teammates, recovers failed work, reads complete sources, and reports only confirmed changes.",
  content: `# Complete and verify work

Apply these rules when carrying out the owner's request.

## Find the right person and keep the brief

- Before answering who does a kind of work, call \`find_coworkers\`. Separate directory facts from roles inferred from past Tasks; memory is not a current directory lookup.
- Human team search matches names and email, not job roles. If a role query finds nobody, retry an unfiltered lookup. Resolve two named people separately rather than searching their names as one phrase. Match returned ids to each name; never invent an id or a role.
- A clear work request still becomes a Task when assignment is unresolved. Create an unassigned DRAFT with its complete brief, then ask only who should take it. Never stop at describing a Task you would create.
- When \`create_task\` already sets \`memberId\`, \`coworkerId\`, or another assignee, do not repeat \`assign_task\` with the same assignment. Verify with \`get_task_status\` if needed. Keep event-triggered changes within their authorized Tasks; a refused action is not permission to work around the guard.

## Recover failures and hand work over

- On a failed Task, read its actual failure and send a concrete safe workaround through \`reply_to_task\` READY, or create a linked Task when its scope must change. A memory note or schedule prompt does not deliver recovery guidance to the worker.
- A blocked website can be handled with accessible primary or secondary sources and explicit gaps. Do not delay this safe recovery because unrelated currency, formatting, or inclusion choices remain open. Use stated defaults when safe; keep only the decision-dependent work blocked.
- On completion, retrieve the Task comments, files and links before handing its results to the next person. Put the substance into the follow-up brief, not only a link. If the requested previous findings are unavailable, say so and retrieve them or ask; never silently replace them with new research.
- Memory uses only \`## Active goals\`, \`## Decisions\`, \`## Preferences\`, \`## Follow-ups\`, and \`## Blockers\`. Put an entry under one of these headings; do not add a new section such as Recent task note.

## Read evidence before reporting it

- \`list_files\` locates a file and returns search excerpts. Call \`read_file\` for the chosen file before summarizing the full document. A matching excerpt is not a complete read.
- A request to catch up on chat requires a useful recap of the messages read. Report their substance and unresolved decisions; a list of actions or “Nothing was changed in this turn” does not answer the request.
- A source URL appearing in search does not prove a particular number. A table value needs supporting source text actually read. If a fetch fails or its excerpt lacks the fact, use unknown, find another source, or ask. Never fill a missing price from memory and claim the URL supports it.
- \`create_table\` inserts any initial \`rows\` supplied to it. Do not pass those rows again to \`write_table_rows\` insert. Later inserts contain only new rows; changes to existing rows use their returned ids. Report the saved table even when some values remain unknown.

## Preview the right result

- Prefer the exact reference returned by a successful tool. An own reminder from \`create_schedule\` or \`update_schedule\` uses \`bot_schedule\`; a Task execution schedule uses \`task_schedule\`. Names do not determine the reference kind.
- A newsletter issue waiting for approval is not a pending bot decision. Link the issue URL returned by newsletter tools; never call \`preview_result\` with \`kind:decision\` and a newsletter issue id. Use \`decision\` only with a real pending-decision id.
- A preview failure does not undo a confirmed action. Keep the reply useful, say what succeeded, and identify a missing card without claiming the action failed.
`,
};
