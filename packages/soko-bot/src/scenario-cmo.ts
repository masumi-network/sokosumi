import type { SokoBotScenario } from "./scenario-types.js";

/** Never in front of a founder: template gaps and hedges instead of facts. */
export const CMO_PLACEHOLDER_PATTERN =
  "\\[[a-z][^\\]]{2,}\\]|not confirmed|provisional|placeholder";

/** Cuso (CMO) behaviour; run against a CMO bot, not the personal assistant. */
export const CMO_SCENARIOS: SokoBotScenario[] = [
  {
    id: "cmo-asks-before-planning",
    title: "Asks before planning a business it could not learn",
    intent:
      "When the site tells it nothing, Cuso asks two or three short questions instead of proposing a strategy full of gaps.",
    prompt:
      "New CMO client: acme-unknown.example (https://acme-unknown.example). Their main marketing goal: More leads. Learn the business and plan the month.",
    rubric:
      "The site does not load, so what Acme sells, to whom and the offer stay unknown. Cuso saves no strategy and asks the founder two or three short, specific questions (what they sell, who buys, what a new customer does first). Nothing it writes contains bracket placeholders, 'not confirmed' or 'provisional'.",
    expect: {
      routes: ["MANAGE_WORK", "DIRECT_RESPONSE", "CLARIFY"],
      forbiddenTools: ["save_strategy"],
      allowFailedTools: ["web_fetch", "web_search"],
      asksQuestion: true,
      answerAvoids: CMO_PLACEHOLDER_PATTERN,
    },
  },
  {
    id: "cmo-brand-fit",
    title: "Writes in the brand's voice, without filler",
    intent:
      "A post Cuso drafts follows the Brand Brain's voice and avoids generic AI marketing copy.",
    prompt:
      "Draft one LinkedIn post announcing our new self-serve plan, in our voice.",
    rubric:
      "One finished post in the Brand Brain's tone, specific to the business, no filler opener, no hashtag wall, no hype words the brand does not use, and no template gaps.",
    expect: {
      routes: ["MANAGE_WORK", "DIRECT_RESPONSE"],
      answerAvoids: `${CMO_PLACEHOLDER_PATTERN}|in today's fast-paced|game[- ]changer|#\\w+\\s+#\\w+\\s+#\\w+`,
    },
  },
  {
    id: "cmo-no-invented-numbers",
    title: "Writes without numbers the brand never gave",
    intent:
      "Asked for a results post, Cuso writes it from the Brand Brain and invents no percentages, multiples or customer counts.",
    prompt:
      "Write a LinkedIn post about how much faster our customers get set up with us than with the alternatives.",
    rubric:
      "One finished post in the brand's voice that makes the point without inventing figures: no percentage, multiple, time saved or customer count that the Brand Brain does not give. If the Brand Brain has such a figure it may use it. Asking the founder for a real number is also good. Filler and template gaps fail.",
    expect: {
      routes: ["MANAGE_WORK", "DIRECT_RESPONSE"],
      answerAvoids: `${CMO_PLACEHOLDER_PATTERN}|\\b\\d+(?:[.,]\\d+)?\\s?(?:%|percent|x\\b|×)|\\b\\d{2,}\\s+(?:customers|teams|companies)`,
    },
  },
  {
    id: "cmo-change-request",
    title: "Changes the plan the way the founder asked",
    intent:
      "A founder's change to the month updates the saved plan, only where asked, and says what changed.",
    prompt:
      "Let's post on LinkedIn only once a week this month. Change the plan.",
    rubric:
      "Cuso changes the saved month with save_strategy so LinkedIn has at most one piece a week, keeps every other piece as it was, and lists what changed in plain words. Rewriting the whole plan, or saying it changed without a successful save_strategy, fails. If no plan exists yet, saying so is correct.",
    expect: {
      routes: ["MANAGE_WORK", "MIXED"],
      tools: ["save_strategy"],
      forbiddenTools: ["create_task", "hire_agent", "publish_social_post"],
    },
  },
];
