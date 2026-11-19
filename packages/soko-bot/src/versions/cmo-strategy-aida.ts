import type { SokoBotSkill } from "./skills.js";

/**
 * cmo-v5's strategy skill: the funnel in the four classic stages (owner,
 * 2026-11-18), as an exact replacement of the funnel's opening in the skill
 * it builds on, so the rest stays word for word. The owner knows a marketing
 * funnel as Awareness, Interest, Desire, Action; Cuso's own stage names
 * ("See the work", "Judge the preview") read as invented.
 */
const REVISIONS: readonly (readonly [string, string])[] = [
  [
    `- funnel: the heart of the strategy, how a stranger becomes a customer, three or four stages top to bottom: awareness, consideration, conversion and, when repeat business matters, loyalty. Each stage has:
  - name in the buyer's words (at most four words: "Hear about us", "Try a first order") and goal (at most 10 words);`,
    `- funnel: the heart of the strategy, how a stranger becomes a customer, in the four stages every marketer knows, always all four and in this order: awareness (people who could buy hear of the business), interest (they look closer), desire (they want it), action (they buy, book or sign up). Never another stage, never fewer, and never a name of your own for one: the owner reads Awareness, Interest, Desire, Action. What a customer is offered after buying goes in ladder.next, not in a fifth stage. Each stage has:
  - goal: what people do at this stage, for this business, at most 10 words ("Parents see a five-minute recipe");
  - cusoDoes: what you do at this stage, one plain sentence of at most 20 words, starting with "I" and naming the work and where ("I post a recipe reel a day on Instagram and run reel ads to parents nearby"). When your work does not reach the stage, say so ("Nothing here: the order happens in your shop");
  - youDo: what the owner does at this stage, one plain sentence of at most 20 words starting with "You" ("You answer booking requests within a day"). Only work this stage itself needs from them: answering people, keeping a page, a price or an offer right, sending you material. Approving the strategy and connecting accounts are not a stage's work. Leave youDo out, with owner cuso, when the stage needs nothing from them;`,
  ],
];

export const AIDA_STRATEGY_SKILL = "cmo-strategy-aida";

export function aidaStrategy(base: SokoBotSkill): SokoBotSkill {
  const content = REVISIONS.reduce((text, [before, after]) => {
    if (!text.includes(before)) {
      throw new Error(
        `${AIDA_STRATEGY_SKILL}: "${before.slice(0, 60)}" is not in ${base.id}`,
      );
    }
    return text.replace(before, after);
  }, base.content);
  return { ...base, id: AIDA_STRATEGY_SKILL, content };
}
