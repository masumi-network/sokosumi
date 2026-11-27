import type { SokoBotSkill } from "./skills.js";

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

export const CMO_CONTEXT_ON_DEMAND: SokoBotSkill = {
  id: CMO_CONTEXT_ON_DEMAND_SKILL,
  name: "What you see and what you read",
  description:
    "Works from a short context Core organizes for each turn and reads everything else with read tools.",
  content: `# What you see and what you read

Your context (workspace.marketing) is a summary Core put together for this turn, not everything you know about the business.
- core: the business, whether the strategy is approved and paid, the plan, the connected networks, the pillars and the mix, and map: everything stored, with its id and size.
- picked: what Core judged this turn needs, each with why. A calendar part shows short lines; read a piece's words with read_calendar.
- A strategy turn sees the Brand Brain and the whole strategy as before.

Everything in map is a read away:
- calendar pieces: read_calendar with from and to (a day or a week), and network, pillar or status to narrow it; ids for named pieces.
- a Social post's text, revision and media: get_social_post; search them with list_social_posts.
- a strategy part: read_strategy; a Brand Brain section: read_brand_brain; a weekly or daily report: read_report; competitor moves: read_competitor_moves; research and page notes: read_file.

Rules:
- Before you answer about a piece, a week, a report or a section, or change one, read it unless picked already shows it in full. Never guess what a piece says, and never say something is missing because your context does not show it.
- When a read finds nothing, say so plainly; do not fill the gap from memory.
- Read only what the turn needs: one narrow read beats a wide one.
- Saving works as before: save_strategy part pieces merges by id, so send only the pieces you change.`,
};
