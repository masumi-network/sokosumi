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
 * Ads are the owner's Yes or No (owner, 2026-11-19): they cost money on top
 * of the plan, so a first strategy holds none and asks no question about
 * them; Cuso says what he would suggest, and plans ads once the owner said
 * yes and set the amount. The funnel shows everything he does, the weekly
 * SEO audit and the talking videos included, and nothing he does not.
 *
 * The funnel has the four classic stages (owner, 2026-11-18). The owner
 * knows a marketing funnel as Awareness, Interest, Desire, Action; Cuso's own
 * stage names ("See the work", "Judge the preview") read as invented.
 */
const REVISIONS: readonly (readonly [string, string])[] = [
  [
    '- channels: every live social network in the menu the business has an account on (the Brand Brain\'s channels and marketingToday) is in the strategy: its audience is already there, and showing up everywhere the buyers are is what the owner hires you for. Add the networks from the menu where this buyer spends time but the business has no account yet, at most two (LinkedIn for a business that sells to companies, Instagram for a shop, a restaurant or anything people want to see, X when its market talks there). Their why starts with "New:" and says the owner opens the account. Never add a network that does not fit the buyer (a bakery on X). Further networks that would fit go in proposals.',
    '- channels: every live social network in the menu is in the strategy, whether the business has an account there or not: showing up everywhere the buyers are is what the owner hires you for. A network the business has an account on (the Brand Brain\'s channels and marketingToday) has its audience already. A network it has no account on is planned all the same: its why starts with "New:" and says the owner opens the account, whatever its role, main or side, and CMO makes its pieces right away, so they wait finished until the account is connected. Never put a social network in proposals. Leave a network out only when it clearly does not fit this buyer (a bakery on X, a payroll tool on Instagram), and then name it in leftOut with its channel key and why in at most 12 words, tied to the Brand Brain. leftOut holds live networks only, never one the menu marks as coming soon; a network you are merely unsure about is planned as a side channel. The strategy review refuses a live network that is in neither channels nor leftOut. YouTube and TikTok take only video: each is in channels with the cadence "1 a week", and its pieces are the month\'s talking videos, which list it in alsoOn (see the talking video rule below); never plan a youtube or tiktok entry of its own beyond them. A TikTok video waits for the owner to confirm it in their app, as TikTok requires.',
  ],
  [
    "- proposals: two or three channels from the menu below that fit this buyer but are not in the strategy because the owner has no account, list or budget there yet: a network with no profile in the Brand Brain, a newsletter without a mailing list, the other ads channel.",
    "- proposals: up to three channels from the menu below that fit this buyer but are not in the strategy because the owner has no list or budget there yet: a newsletter without a mailing list, an ads channel. Never a social network: those are in channels or in leftOut.",
  ],
  [
    " An ads channel when paid reach fits the strategy (meta_ads or google_ads, whichever reaches this buyer); it is a test the owner chooses to try (see ads and questions), so the strategy works without it.",
    " An ads channel (meta_ads or google_ads) only once the owner said yes to ads (see ads): a first strategy has none.",
  ],
  [
    'State your estimate and ask if it holds. When the strategy has an ads channel, one question asks whether the owner wants to try it, with the channel and your amount in it ("Do you want to try Google Ads with about CHF 600 a month?"); never ask whether an amount is reasonable or enough. A no means monthly 0 and no ads channel.',
    'State your estimate and ask if it holds ("Do about 30 new accounts start each week?", never "Can you count new account starts each week?": the strategy review refuses a question that asks whether the owner can count, share, track or tell you something). Never ask about ads or an ad budget: the owner answers that with a Yes or No of its own, right on the strategy.',
  ],
  [
    'Plan it once, on the network where it matters most, and list the strategy\'s other networks that take a talking_video in its alsoOn (alsoOn: ["youtube", "facebook"]).',
    'Plan it once, on the network where it matters most, and list every other network in the strategy that takes a talking_video in its alsoOn (alsoOn: ["youtube", "tiktok", "facebook", "instagram"]): a talking video always goes out everywhere it can. Plan up to four a month, about one a week, so YouTube and the other short-video feeds get one every week.',
  ],
  [
    `- funnel: the heart of the strategy, how a stranger becomes a customer, three or four stages top to bottom: awareness, consideration, conversion and, when repeat business matters, loyalty. Each stage has:
  - name in the buyer's words (at most four words: "Hear about us", "Try a first order") and goal (at most 10 words);`,
    `- funnel: the heart of the strategy, how a stranger becomes a customer, in the four stages every marketer knows, always all four and in this order: awareness (people who could buy hear of the business), interest (they look closer), desire (they want it), action (they buy, book or sign up). Never another stage, never fewer, and never a name of your own for one: the owner reads Awareness, Interest, Desire, Action. The funnel shows everything you do and nothing you do not: every channel in the strategy appears at the stage it serves, the talking videos where they explain (name them as videos in the play), the newsletter when there is a list, and ads only once the owner said yes. Your weekly work on the owner's site belongs in it too, though it is never in channels or the calendar: one play with channel seo at the stage where people search for what the business solves (awareness or interest), saying "A weekly audit of your site with page fixes, and articles for the searches your buyers make when you ask", and that stage's youDo says the owner puts the fixes and articles on their site. What a customer is offered after buying goes in ladder.next, not in a fifth stage. Asked to change only the funnel of a saved strategy, send funnel alone with part patch: a list you send replaces the saved one, so never send channels, mix or another list along, and name only channels the strategy already has. Each stage has:
  - goal: what people do at this stage, for this business, at most 10 words ("Parents see a five-minute recipe");
  - cusoDoes: what you do at this stage, one plain sentence of at most 20 words, starting with "I" and naming the work and where ("I post a recipe reel a day on Instagram and run reel ads to parents nearby"). When your work does not reach the stage, say so ("Nothing here: the order happens in your shop");
  - youDo: what the owner does at this stage, one plain sentence of at most 20 words starting with "You" ("You answer booking requests within a day"). Only work this stage itself needs from them: answering people, keeping a page, a price or an offer right, sending you material. Approving the strategy and connecting accounts are not a stage's work. Leave youDo out, with owner cuso, when the stage needs nothing from them;`,
  ],
];

export const EVERY_NETWORK_STRATEGY_SKILL = "cmo-strategy-every-network";

/** The ads rule, whole: the owner's Yes or No decides, never Cuso's recommendation. */
const ADS = `- ads: paid ads cost the owner money on top of their plan, so the owner decides, with a Yes or No on the strategy. Until they said yes (ads.setByOwner is true and monthly is above 0), monthly is 0: there is no ads channel, no ad in the calendar and nothing about ads in the funnel, and the strategy reaches its goal without them. Say what you would do if they say yes in suggest: channel (meta_ads for shops, consumer brands and local businesses; google_ads for urgent or high-intent searches) and monthly, the amount you would start with in the business's currency (modest, enough to learn: what one month of tests needs for this buyer). Leave suggest out when the Brand Brain says the business does not advertise ("we never pay for ads", "growth by word of mouth only"). currency (ISO, "EUR"), expect (what the suggested amount should bring in a month, a range in words, at most 15 words) and without (how the strategy grows with no ads, at most 12 words). When ads.setByOwner is true and monthly is above 0 the owner said yes and chose the amount: keep monthly and currency exactly, add the ads channel with two to four ads in the calendar, and put the ads in the funnel at the stage they serve, worded as what is true: you write the ads, the owner launches them and pays the ad network ("I write search ads for teams looking for a scheduler; you launch them", never "I run ads"). Tell the owner in your answer, in two lines, what the amount should bring as a range and that they launch the ads and pay the ad network. When the owner set 0 they said no: no ads anywhere.`;

/** The skill with the bullet that starts with `start` replaced whole. */
function withBullet(content: string, start: string, bullet: string): string {
  const lines = content.split("\n");
  const at = lines.findIndex((line) => line.startsWith(start));
  if (at === -1)
    throw new Error(`${EVERY_NETWORK_STRATEGY_SKILL}: no bullet "${start}"`);
  lines[at] = bullet;
  return lines.join("\n");
}

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
  return {
    ...base,
    id: EVERY_NETWORK_STRATEGY_SKILL,
    content: withBullet(content, "- ads: ", ADS),
  };
}
