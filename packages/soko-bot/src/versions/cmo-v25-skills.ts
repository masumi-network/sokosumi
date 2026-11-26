import type { SokoBotSkill } from "./skills.js";

/**
 * cmo-v25's skill: Core writes the strategy in one step (generate, check the
 * whole plan, one repair, save) instead of Cuso saving it in an agent loop
 * and later turns repairing it.
 */
export const CMO_STRATEGY_STEP_SKILL = "cmo-core-writes-strategy";

/** Whether Core writes a Cuso version's strategy in one step (cmo-v25). */
export function cmoWritesStrategyStep(skills: readonly string[]): boolean {
  return skills.includes(CMO_STRATEGY_STEP_SKILL);
}

export const CMO_STRATEGY_STEP: SokoBotSkill = {
  id: CMO_STRATEGY_STEP_SKILL,
  name: "Core writes the strategy",
  description:
    "Has Core write, check and save the strategy in one step, and passes the owner's changes to it.",
  content: `# Core writes the strategy

Core writes your strategy in one step with write_strategy. It follows your strategy skill, reads the Brand Brain, the industry research and the brief, checks the whole plan against every rule at once, fixes what the checks find and saves it. Its answer ends the turn with your sentence for the owner.
- In a strategy turn, call write_strategy before anything else, with no input.
- When the owner asks to change the strategy (a network, how often it posts, a pillar, the offer, the ads, an example post), call write_strategy with change: the owner's request in their own words, plus anything from the chat it needs. Core changes only what the request touches.
- When it answers that Core is still writing, call it again with the same input to wait. Do nothing else meanwhile.
- Only when it answers that Core could not write the strategy, save it yourself with save_strategy as your strategy skill says.`,
};
