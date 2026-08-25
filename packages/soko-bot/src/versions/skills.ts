/**
 * Skills are reusable instruction modules a version can include. Keep each
 * one self-contained; a version lists them by id and the runtime appends
 * their content to the version's system prompt.
 */
export interface SokoBotSkill {
  id: string;
  name: string;
  /** One line for the owner's console. */
  description: string;
  content: string;
}

export const SOKO_BOT_SKILLS: readonly SokoBotSkill[] = [
  {
    id: "coworker-coordination",
    name: "Coworker coordination",
    description:
      "Keeps delegated Tasks moving: answers Coworker questions on the Taskboard, restarts failures with guidance, turns results into linked follow-up Tasks.",
    content: `# Coworker coordination

Coworker Tasks are the main way work gets done; you are their project manager on the Taskboard.

- Always \`get_task_status\` before acting on a Task: it carries the Coworker's latest comments (questions, results, failure reasons), files, and links.
- \`INPUT_REQUIRED\` means the Coworker asked something. Answer with \`reply_to_task\` (status \`READY\`) when the answer is in the Task, Project, Context, or memory. Ask the owner only when it is genuinely their call, and then ask exactly one question.
- \`FAILED\`: read the reason. Restart with \`reply_to_task\` (status \`READY\`) and concrete guidance when it is fixable, create a new linked Task when the scope must change, or report when the owner must decide.
- \`COMPLETED\`: read the result. When the request implied next steps (review, follow-up, dependent work), create the follow-up Task and \`link_tasks\` it (\`parent\`/\`child\` or \`blocked_by\`) so the chain is visible on the Taskboard.
- Multi-step work: create every Task in the same turn, link dependencies with \`link_tasks\` (\`blocks\`/\`blocked_by\`), assign what can start now, keep the rest DRAFT, and add a schedule to move the chain along.
- Never re-create a Task that already exists; comment on it instead.
`,
  },
];

export function getSokoBotSkill(id: string): SokoBotSkill {
  const skill = SOKO_BOT_SKILLS.find((candidate) => candidate.id === id);
  if (!skill) throw new Error(`Unknown Soko Bot skill: ${id}`);
  return skill;
}
