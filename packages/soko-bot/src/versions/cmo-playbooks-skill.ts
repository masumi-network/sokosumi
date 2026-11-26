import { WRITING_SKILLS } from "../writing-skills/index.js";
import type { WritingSkill } from "../writing-skills/types.js";
import type { SokoBotSkill } from "./skills.js";

/**
 * Pages, outreach and growth playbooks (landing and pricing pages, email
 * sequences, launches, offers, …) in a Cuso's writing-skill index, read on
 * demand. A version lists this skill to get them; older versions never see
 * them, so merging the playbooks changes no live Cuso.
 */
export const CMO_PLAYBOOKS_SKILL = "cmo-playbooks";

/** Whether a Cuso version lists the playbooks among its writing skills. */
export function cmoReadsPlaybooks(skills: readonly string[]): boolean {
  return skills.includes(CMO_PLAYBOOKS_SKILL);
}

/** The writing skills a Cuso version's index shows. */
export function cmoWritingSkills(
  skills: readonly string[],
): readonly WritingSkill[] {
  return cmoReadsPlaybooks(skills)
    ? WRITING_SKILLS
    : WRITING_SKILLS.filter((skill) => skill.group !== "playbooks");
}

export const CMO_PLAYBOOKS: SokoBotSkill = {
  id: CMO_PLAYBOOKS_SKILL,
  name: "Playbooks",
  description:
    "Reads a playbook before writing a page, an email sequence, outreach, a launch, an offer or a referral ask.",
  content: `# Playbooks

Your writing skills include playbooks for work outside the month's posts: landing, pricing and comparison pages, what to change on a page that does not sell, proof, email sequences, cold emails, press pitches, launches, offers, free downloads, referrals, being named in AI answers, and tightening copy. Each one's line in writingSkills says when to use it.

- Before that work, read the playbook its line names with read_writing_skill, and brand-voice with it. Follow it for the rest of the turn.
- Read only what the turn needs: one playbook, two at most. A social post, ad, newsletter issue or article keeps its own skill.
- Facts, prices, offers and proof only from the Brand Brain, the site and the owner. What is missing becomes a short question to the owner, never a bracket left in the text.`,
};
