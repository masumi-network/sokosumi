import type { SokoBotSkill } from "./skills.js";

/**
 * Core's month writer writes several first lines for every Social post and
 * keeps the strongest, the way cmo-v11 makes several pictures and picks one;
 * each chunk also reads the posts that did best for the brand and its
 * competitors on that network (owner, 2026-11-25).
 */
export const CMO_PICKED_OPENINGS_SKILL = "cmo-picked-openings";

/** Whether a Cuso version's writer picks each post's first line from several. */
export function cmoPicksOpenings(skills: readonly string[]): boolean {
  return skills.includes(CMO_PICKED_OPENINGS_SKILL);
}

/** What Core's month writer adds to its brief for such a version. */
export const CMO_OPENINGS_WRITING_GUIDE = `## Openings
For every Social post you write a draft for, give openings: four other first lines for that draft, each a different angle on the same piece (a number from the business, a named customer and what they did, a result, a decision that sounds surprising, a before and after). Each is one line, true from the piece's brief, its claim, the Brand Brain or the draft's own words: never a new number, name or fact. The rest of the draft must still read right under each one. No questions, no advice. Core keeps the strongest of the draft's own first line and these four. Leave openings null for scripts, articles and newsletter issues.`;

export const CMO_PICKED_OPENINGS: SokoBotSkill = {
  id: CMO_PICKED_OPENINGS_SKILL,
  name: "Several openings, the best kept",
  description:
    "Core writes five first lines for every post of the month and keeps the strongest, learning from the posts that did best.",
  content: `# Several openings, the best kept

Core's month writer writes five first lines for every Social post it drafts and keeps the strongest, judged side by side. It also reads the posts that did best for the business and its competitors on each network, for their rhythm, never their facts.

When you fix a post Core handed back, keep its first line unless the reason names it. When you write a post yourself, write its first line last: the most surprising true thing in the piece.`,
};
