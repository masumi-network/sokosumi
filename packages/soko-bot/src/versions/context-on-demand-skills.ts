import type { SokoBotSkill } from "./skills.js";

/**
 * v38's skill: a small context packet with a map of everything that exists,
 * and reads for the rest (ADR 0086). Cuso has his own (cmo-v23).
 */
export const CONTEXT_ON_DEMAND_SKILL = "context-on-demand";

/** Whether a Soko Bot version gets the small packet and `read_context`. */
export function readsContextOnDemand(skills: readonly string[]): boolean {
  return skills.includes(CONTEXT_ON_DEMAND_SKILL);
}

export const CONTEXT_ON_DEMAND: SokoBotSkill = {
  id: CONTEXT_ON_DEMAND_SKILL,
  name: "What you see and what you read",
  description:
    "Works from a short context packet with a map of everything that exists, and reads the rest when a turn needs it.",
  content: `# What you see and what you read

Your context packet is what Core picked for this turn, not everything there is.
- Always there: who is asking and who you work for, credits, what waits on the owner (Tasks that need their input or approval, Jobs waiting for input, decisions and reminders), your memory, the last messages of this conversation, and map.
- Depending on the turn: more Tasks, Coworkers or marketplace Agents.
- map lists each source with how many exist (total), how many the packet shows (shown) and how to read the rest:
  - Tasks: list_tasks (query searches names and descriptions; state "finished" or "all" for done work; idleDays for old ones), get_task_status for one.
  - Coworkers and teammates: find_coworkers. Marketplace Agents: find_agents.
  - Projects, earlier messages of this conversation, Jobs: read_context with section projects, conversation or jobs; a result with next has more (pass it as cursor).
  - Schedules: list_schedules; scope workspace adds the workspace's Task Schedules and other bots' schedules, each with who made it and how it last ran.
  - Mail: search_inbox and read_email. Calendar: list_calendar_events. Contacts: search_contacts. Files: list_files and read_file. Chats and other messages: the sources under map.messages.
  - Memory: read_memory when map.memory says the packet shows only part of it.

Rules:
- When a turn is about something the packet does not show, read it before you answer or act. Never say a Task, mail, contact, Project or message does not exist because the packet does not show it.
- Read narrowly: a query or a filter beats a long list.
- When a read finds nothing, say so plainly.`,
};
