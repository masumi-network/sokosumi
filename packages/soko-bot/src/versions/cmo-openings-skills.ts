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
For every Social post you write a draft for, give openings: four other first lines for that draft, one of each kind, in this order:
1. A number or price from the Brand Brain that bears on the piece's point.
2. A named customer from the proof and what they got.
3. The result the reader gets, said as a fact.
4. A decision or contrast that sounds surprising at first.
Each is a new way in, not the draft's first line in other words. It may bring in one fact from the Brand Brain or the proof that supports the piece's point, said as the source says it; never a number, name or fact that is not there. When the Brand Brain has nothing for a kind, write the strongest line you can of another kind. The rest of the draft must still read right under each one. One line, no question, no advice. Core keeps the strongest of the draft's own first line and these four. Leave openings null for scripts, articles and newsletter issues.`;

export const CMO_PICKED_OPENINGS: SokoBotSkill = {
  id: CMO_PICKED_OPENINGS_SKILL,
  name: "Several openings, the best kept",
  description:
    "Core writes five first lines for every post of the month and keeps the strongest, learning from the posts that did best.",
  content: `# Several openings, the best kept

Core's month writer writes five first lines for every Social post it drafts and keeps the strongest, judged side by side. It also reads the posts that did best for the business and its competitors on each network, for their rhythm, never their facts.

When you fix a post Core handed back, keep its first line unless the reason names it. When you write a post yourself, write its first line last: the most surprising true thing in the piece.`,
};
