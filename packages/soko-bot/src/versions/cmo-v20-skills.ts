import { CMO_PRODUCTION_TURN_PREFIX } from "../cmo.js";
import { LINKEDIN_HOOK_RULE } from "../writing-skills/social.js";
import type { WritingSkill } from "../writing-skills/types.js";
import { CMO_PLAIN_WORDS_STRATEGY_SKILL } from "./cmo-v15-skills.js";
import type { SokoBotSkill } from "./skills.js";

/**
 * cmo-v20's strategy skill: cmo-v15's with every funnel step on every
 * network, short videos cut from a script, and pillars built on facts.
 */
export const CMO_V20_STRATEGY_SKILL = "cmo-strategy-v20";

/** cmo-v20's skill: Core gives each piece its point and marks the offer pieces. */
export const CMO_MONTH_POINTS_SKILL = "cmo-month-points";

/**
 * entry.fyi's cmo-v15 month (2026-11-22): "You approve what goes live" led
 * 18 of 96 X posts while 2 carried the offer's link the funnel promised twice
 * a week. Core now assigns each piece one point and marks the offer pieces
 * before its writer runs; this tells Cuso what they mean when he fixes one.
 */
export const CMO_MONTH_POINTS: SokoBotSkill = {
  id: CMO_MONTH_POINTS_SKILL,
  name: "Points and offer pieces",
  description:
    "Each piece of the month argues its own point; the offer pieces carry the offer's link.",
  content: `# Points and offer pieces

- Before the month is written, Core gives every piece its claim: the one point it argues, from the Brand Brain, no point leading more than a few pieces on one network. A piece argues its claim and no other piece's. When you fix a piece Core handed back, keep its claim.
- Core marks the offer pieces the funnel promises (two a week on each network of its action stage). An offer piece ends with the offer's action. On X, LinkedIn and Facebook its link goes in firstComment and the post says it is below; on Instagram and TikTok it says the link is in the bio. Core refuses an offer piece without it.`,
};

/**
 * cmo-v20's LinkedIn skill. entry.fyi's and NMKR's LinkedIn posts (2026-11)
 * failed "built on one real experience" about nine times in ten: they cited
 * the business's own site in the third person ("NMKR lists…", "Entry's
 * product description says…"), turned a fact into advice any business could
 * give, ran 250 to 450 characters, and often ended with two asks.
 */
export const CMO_SPECIFIC_LINKEDIN_SKILL: Omit<WritingSkill, "audience"> = {
  id: "linkedin",
  group: "social",
  name: "LinkedIn",
  description:
    "Read before any LinkedIn post: one specific story, number or decision from the business, its first line before 'see more', short paragraphs, one ask.",
  channels: ["linkedin"],
  content: `# LinkedIn

People at work read LinkedIn on a phone. They see about two lines (roughly 140 characters) before "see more". A post earns the tap with one specific thing only this business can say, then pays it off in a few short paragraphs.

## First pick the post's one specific thing

Take it from the Brand Brain and the piece's story or claim, in this order:
1. **A story**: a named customer, the founder or the team did something and something came of it ("Francis's about.me page had not changed in 13 years. So he built Entry.").
2. **A number and what it means**, worked out for the reader ("50 tokens at the 2 ADA minimum is 100 ADA before you sell one.").
3. **A decision the business made** and what it changes for the reader ("We delete an unclaimed preview after 24 hours. Here is what that means for you.").
4. **A dated event or launch** and what the business brings to it.

When the piece's story is a fact rather than something that happened, use it as 2 or 3. Never invent a story, a customer, a quote, a reason or a result.

## Write it as the business

- Write as "we", the business's own page, or about the named person in the story. Never cite the business's own site or materials as a source: not "Entry's site says", "NMKR lists", "the product description states", "an interview describes". Say the fact itself.
- **First line**: the specific thing, with its name or number, at most about 140 characters. Advice, a definition, a feature description or company history is not a first line ("Entry connects GitHub, X and your site" describes a feature; "Francis's about.me page sat unchanged for 13 years" makes people tap).
- **Then pay it off** in three to six short paragraphs of one or two sentences, a blank line between each: what happened or what the number means, one concrete example with real names (the product, plan, price, place), and what the reader can do with it.
- **Concrete, not abstract**: say what actually happens instead of "a way to", "can help", "useful", "a clearer view", "a chance to".
- **Length**: 600 to 1,300 characters. A post under 400 characters is too thin here: tell more of the story or work the example through, never add filler.
- **One ask at the end, never two**: a question the reader can answer from their own work, or on an offer piece the offer's action. Not a question and an action.
- **Links** go in firstComment; the post can say "Link in the first comment."
- **Hashtags** add little: usually none, at most 3 specific ones on the last line.

## Formats

**post** (text): the full shape below, no picture.

**image**: the image carries one thing (a chart, a product, a moment); the text is 400 to 900 characters and says what the image means. The first line still makes people tap without the image.

**images** (two to four images): one story told across the images, one idea per image: a walkthrough, a problem then the proof, a before and after. The first image works on its own; there are exactly as many images as it promises. The text introduces the story and tells people to swipe.

**video** (short vertical video): the point in the first second. Most people watch muted, so the text carries the words: two to four short lines with the first line, what the video shows and why it matters.

## Shape of a text post

\`\`\`
[The specific thing: a story, a number or a decision, one or two lines]

[What was going on, one or two sentences]

[What happened, or the number worked through with real names]

[What it changes for the reader]

[One ask: a question about their own work, or the offer's action]
\`\`\`

## Example shape

A made-up bakery, structure only:

\`\`\`
We stopped baking 40 kinds of bread. Sales went up 18%.

For years we thought choice was the point. Every morning, 40 kinds on the shelf.

Then we looked at the numbers. Six breads made 80% of the sales. The other 34 made waste.

So we cut to 12. The bakers had time to do each one properly, and the queue moved faster.

What would you stop making if you looked at your numbers?
\`\`\`

## Never

- Citing your own website, pages or press kit as the source of a fact
- A fact followed by advice any business in the category could give
- "I'm excited to announce", "I'm humbled", "Let that sink in."
- One-word lines for drama
- "Agree?" or "Thoughts?" as the ending
- Tagging people or companies who are not in the story
- A link in the post body`,
  checklist: [
    { rule: LINKEDIN_HOOK_RULE },
    {
      rule: "Short paragraphs of one or two sentences with blank lines between them.",
    },
    {
      rule: "It is built on one real experience, result or decision, the business's or a named customer's, not generic tips or a list of things to check.",
    },
    {
      rule: "It is written as the business or about the person in its story, and never cites the business's own site or materials as a source.",
    },
    {
      rule: "It ends with one ask: a question or the offer's action, not both.",
    },
    {
      rule: "Multi-image post: the text introduces one story told across the images and tells people to swipe.",
      formats: ["images"],
    },
    {
      rule: "Text post at most about 1,500 characters, image or video post about 900; no link in the body; at most 3 hashtags.",
      counted: true,
    },
  ],
};

/** Whether a Cuso version's month writer gives each piece its point (cmo-v20). */
export function cmoMarksPoints(skills: readonly string[]): boolean {
  return skills.includes(CMO_MONTH_POINTS_SKILL);
}

/** The writing skills a Cuso version writes by in place of the shared ones. */
export function cmoRevisedWritingSkills(
  skills: readonly string[],
  shared: readonly WritingSkill[],
): WritingSkill[] {
  if (!cmoMarksPoints(skills)) return [];
  const audience = shared.find((skill) => skill.id === "linkedin")?.audience;
  return [
    { ...CMO_SPECIFIC_LINKEDIN_SKILL, ...(audience ? { audience } : {}) },
  ];
}

/**
 * Skills a cmo-v20 production run leaves out of its system prompt. Every
 * cmo-v15 turn carried all 14 skills (142 KB, about 35,000 tokens) on each
 * step; a production run (59 steps on entry.fyi's month) writes with Core's
 * month writer and never plans a strategy or researches the Brand Brain, the
 * two biggest (49 KB and 22 KB). Chat, strategy and daily turns keep them.
 */
const NOT_IN_PRODUCTION: ReadonlySet<string> = new Set([
  CMO_PLAIN_WORDS_STRATEGY_SKILL,
  CMO_V20_STRATEGY_SKILL,
  "cmo-brand-brain-groups",
]);

/** The skills a turn's system prompt carries, by the kind of turn. */
export function cmoTurnSkills(
  skills: readonly string[],
  clientTurnId: string | null | undefined,
): readonly string[] {
  if (
    !cmoMarksPoints(skills) ||
    !clientTurnId?.startsWith(CMO_PRODUCTION_TURN_PREFIX)
  )
    return skills;
  return skills.filter((id) => !NOT_IN_PRODUCTION.has(id));
}

/**
 * entry.fyi's cmo-v15 plan (2026-11-22) made "Owner control" a pillar at
 * 25%: the site's own refrain "You approve what goes live" (about six times
 * on its homepage), a trust note rather than a reason to buy, so a quarter
 * of the month argued one line.
 */
const PILLARS_SECTION = `

# Pillars rest on facts

- A pillar is something the buyer gets or does: a job they get done, an audience the business serves, or a feature that solves a problem for them. Never a reassurance or a trust line ("you approve what goes live", "no credit card needed", "cancel any time", "your data stays yours"): a refrain the site repeats is a supporting line a few posts may carry, never a pillar.
- Each pillar rests on at least three different facts from the Brand Brain: features by their name, prices and plans, numbers, customers, dated events, the founder's story. One thing the site says in several places is one fact. Give a pillar no bigger share than its facts can carry.
- A simple product gets fewer pillars: three is fine. Never stretch one fact across a pillar.
- The strategy review counts each pillar's facts and names a pillar that rests on fewer than three, or holds more of the month than its facts carry: merge it into another pillar or reframe it around what the buyer gets, then move its calendar entries to the pillar they now belong to.`;

/** `stageSpread` is cmo-v15's plain-words skill with every step on every network. */
export function cmoV20Strategy(stageSpread: SokoBotSkill): SokoBotSkill {
  return {
    ...stageSpread,
    id: CMO_V20_STRATEGY_SKILL,
    content: `${stageSpread.content}${PILLARS_SECTION}`,
  };
}
