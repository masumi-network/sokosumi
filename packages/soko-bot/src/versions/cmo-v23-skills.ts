/**
 * cmo-v23's skill: a small context Core organizes before each turn, and
 * read tools for the rest of the Brand Brain, strategy, calendar, reports
 * and competitor moves.
 */
export const CMO_CONTEXT_ON_DEMAND_SKILL = "cmo-context-on-demand";

/** Whether a Cuso version gets an organized context and its read tools (cmo-v23). */
export function cmoReadsOnDemand(skills: readonly string[]): boolean {
  return skills.includes(CMO_CONTEXT_ON_DEMAND_SKILL);
}
