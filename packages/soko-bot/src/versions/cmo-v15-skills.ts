import { cmoPlainWordsLine } from "@sokosumi/utils";
import type { SokoBotSkill } from "./skills.js";

/** cmo-v15's strategy skill: cmo-v14's, written for an owner who is not a marketer. */
export const CMO_PLAIN_WORDS_STRATEGY_SKILL = "cmo-strategy-plain-words";

/**
 * The owner on NMKR's cmo-v14 strategy (2026-11-22): "It needs to be really
 * crystal clear and understandable for non-marketing people. EASY." The goal
 * read "More qualified teams starting their first Studio project", a metric
 * "Launch content impressions", a question "Is card checkout a deciding
 * factor for most project leads evaluating Studio?".
 */
export const CMO_PLAIN_WORDS_RULE = `- Write everything the owner reads (the goal, the summary, each stage, each why, each question, each metric, each campaign, your messages) for a founder who is not a marketer and has two minutes. Name the business or its product, the buyer and the concrete thing that happens ("Project leads open a free NMKR Studio account"), never an abstract state ("qualified teams", "a launch decision they face"). Name a number as what is counted ("people who opened a Studio account"), never a marketing metric. Use none of these words; say the plain thing instead: ${cmoPlainWordsLine()}. A question to the owner asks one thing they know about their own business, in their words.`;

const SECTION = `

# Words for an owner who is not a marketer

${CMO_PLAIN_WORDS_RULE}
The strategy review refuses these words in what the owner reads; fix the words, keep the strategy.`;

/** `base` is cmo-v14's channel-fit strategy skill. */
export function plainWordsStrategy(base: SokoBotSkill): SokoBotSkill {
  return {
    ...base,
    id: CMO_PLAIN_WORDS_STRATEGY_SKILL,
    content: `${base.content}${SECTION}`,
  };
}
