import type { SokoBotSkill } from "./skills.js";

/**
 * cmo-v5's strategy skill: cmo-v3's month per network, as exact replacements
 * of its text so the rest stays word for word, with two changes.
 *
 * Every live social network CMO offers is planned (owner, 2026-11-19): a
 * month once held only LinkedIn, X and Google Ads, because a network without
 * an account went to proposals. A network with no account is planned as a
 * side channel, Core makes its pieces and they wait for the connection, and
 * one that does not fit the buyer is left out with its reason. YouTube takes
 * only video, so its pieces are the month's talking videos.
 *
 * The funnel has the four classic stages (owner, 2026-11-18). The owner
 * knows a marketing funnel as Awareness, Interest, Desire, Action; Cuso's own
 * stage names ("See the work", "Judge the preview") read as invented.
 */
const REVISIONS: readonly (readonly [string, string])[] = [
  [
    '- channels: every live social network in the menu the business has an account on (the Brand Brain\'s channels and marketingToday) is in the strategy: its audience is already there, and showing up everywhere the buyers are is what the owner hires you for. Add the networks from the menu where this buyer spends time but the business has no account yet, at most two (LinkedIn for a business that sells to companies, Instagram for a shop, a restaurant or anything people want to see, X when its market talks there). Their why starts with "New:" and says the owner opens the account. Never add a network that does not fit the buyer (a bakery on X). Further networks that would fit go in proposals.',
    '- channels: every live social network in the menu is in the strategy, whether the business has an account there or not: showing up everywhere the buyers are is what the owner hires you for. A network the business has an account on (the Brand Brain\'s channels and marketingToday) has its audience already. A network it has no account on is planned all the same: its why starts with "New:" and says the owner opens the account, and CMO makes its pieces right away, so they wait finished until the account is connected. Never put a social network in proposals. Leave a network out only when it clearly does not fit this buyer (a bakery on X, a payroll tool on Instagram), and then name it in leftOut with its channel key and why in at most 12 words, tied to the Brand Brain; a network you are merely unsure about is planned as a side channel. The strategy review refuses a live network that is in neither channels nor leftOut. YouTube takes only video: it is in channels with the cadence "1 a week", and its pieces are the month\'s talking videos, which list youtube in alsoOn (see the talking video rule below); never plan a youtube entry of its own beyond them.',
  ],
  [
    "- proposals: two or three channels from the menu below that fit this buyer but are not in the strategy because the owner has no account, list or budget there yet: a network with no profile in the Brand Brain, a newsletter without a mailing list, the other ads channel.",
    "- proposals: up to three channels from the menu below that fit this buyer but are not in the strategy because the owner has no list or budget there yet: a newsletter without a mailing list, an ads channel. Never a social network: those are in channels or in leftOut.",
  ],
  [
    'Plan it once, on the network where it matters most, and list the strategy\'s other networks that take a talking_video in its alsoOn (alsoOn: ["youtube", "facebook"]).',
    'Plan it once, on the network where it matters most, and list every other network in the strategy that takes a talking_video in its alsoOn (alsoOn: ["youtube", "facebook", "instagram"]): a talking video always goes out everywhere it can. Plan up to four a month, about one a week, so YouTube and the other short-video feeds get one every week.',
  ],
  [
    `- funnel: the heart of the strategy, how a stranger becomes a customer, three or four stages top to bottom: awareness, consideration, conversion and, when repeat business matters, loyalty. Each stage has:
  - name in the buyer's words (at most four words: "Hear about us", "Try a first order") and goal (at most 10 words);`,
    `- funnel: the heart of the strategy, how a stranger becomes a customer, in the four stages every marketer knows, always all four and in this order: awareness (people who could buy hear of the business), interest (they look closer), desire (they want it), action (they buy, book or sign up). Never another stage, never fewer, and never a name of your own for one: the owner reads Awareness, Interest, Desire, Action. What a customer is offered after buying goes in ladder.next, not in a fifth stage. Each stage has:
  - goal: what people do at this stage, for this business, at most 10 words ("Parents see a five-minute recipe");
  - cusoDoes: what you do at this stage, one plain sentence of at most 20 words, starting with "I" and naming the work and where ("I post a recipe reel a day on Instagram and run reel ads to parents nearby"). When your work does not reach the stage, say so ("Nothing here: the order happens in your shop");
  - youDo: what the owner does at this stage, one plain sentence of at most 20 words starting with "You" ("You answer booking requests within a day"). Only work this stage itself needs from them: answering people, keeping a page, a price or an offer right, sending you material. Approving the strategy and connecting accounts are not a stage's work. Leave youDo out, with owner cuso, when the stage needs nothing from them;`,
  ],
];

export const EVERY_NETWORK_STRATEGY_SKILL = "cmo-strategy-every-network";

/** `base` is cmo-v3's weekly strategy skill. */
export function everyNetworkStrategy(base: SokoBotSkill): SokoBotSkill {
  const content = REVISIONS.reduce((text, [before, after]) => {
    if (!text.includes(before)) {
      throw new Error(
        `${EVERY_NETWORK_STRATEGY_SKILL}: "${before.slice(0, 60)}" is not in ${base.id}`,
      );
    }
    return text.replace(before, after);
  }, base.content);
  return { ...base, id: EVERY_NETWORK_STRATEGY_SKILL, content };
}
