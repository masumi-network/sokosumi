import type { SokoBotSkill } from "./skills.js";

/**
 * Core's month writer tries other first lines for every Social post and
 * keeps one only when it is clearly better, the way cmo-v11 makes several
 * pictures and picks one; each chunk also reads the posts that did best
 * for the brand and its competitors on that network (owner, 2026-11-25).
 */
export const CMO_PICKED_OPENINGS_SKILL = "cmo-picked-openings";

/** Whether a Cuso version's writer tries other first lines for its posts. */
export function cmoPicksOpenings(skills: readonly string[]): boolean {
  return skills.includes(CMO_PICKED_OPENINGS_SKILL);
}

/**
 * The brief for the call that writes other first lines for finished posts.
 * Written after the posts, so the posts themselves are today's: a first
 * version asked the writer for openings of fixed kinds in the same call, and
 * its LinkedIn posts led on prices and drifted into filler (Patrick's blind
 * round, 2026-11-26: old won 9 of 11 LinkedIn pairs).
 */
export const CMO_OPENINGS_WRITING_GUIDE = `You write other first lines for finished social posts. For each post, give four first lines that open the same post a different way: lead with its most surprising true fact, its customer, its result, or the decision it is about, whichever the post really has. Each is one line that the rest of the post still follows naturally, in the post's own voice and language.
Use only facts the post, its brief or the proof already state, said as they state them. Never add a number, name, price or claim. Never turn a post into an ad: no price or plan name first unless the post is about the price. No questions, no advice, no hashtags, no emoji.`;

export const CMO_PICKED_OPENINGS: SokoBotSkill = {
  id: CMO_PICKED_OPENINGS_SKILL,
  name: "Other openings, kept only when better",
  description:
    "Core tries four other first lines for every post of the month and keeps one only when it is clearly better, learning from the posts that did best.",
  content: `# Other openings, kept only when better

Core's month writer tries four other first lines for every Social post it writes and keeps one only when the whole post reads clearly better with it. It also reads the posts that did best for the business and its competitors on each network, for their rhythm, never their facts.

When you fix a post Core handed back, keep its first line unless the reason names it. When you write a post yourself, write its first line last: the most surprising true thing in the piece.`,
};
