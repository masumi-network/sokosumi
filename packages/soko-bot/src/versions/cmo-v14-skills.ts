import type { SokoBotSkill } from "./skills.js";

/** cmo-v14's strategy skill: cmo-v13's, with each network at its own rate. */
export const CMO_CHANNEL_FIT_STRATEGY_SKILL = "cmo-strategy-channel-fit";

/**
 * The owner on NMKR's month (2026-11-21): "too few on X, too many on
 * LinkedIn, not enough pictures, not enough tiktoks, not enough instagram
 * reels (also it doesnt call it reels or youtube shorts)". Each network gets
 * its own top rate, short video goes out every day, the funnel sits where
 * the posts are, and every format carries the platform's own name. Exact
 * replacements of cmo-v13's text, so the rest stays word for word.
 */
const REVISIONS: readonly (readonly [string, string])[] = [
  [
    "and a why of at most 12 words saying what those pieces do for the business.",
    'and a why of at most 12 words saying what the pillar is for: the job its pieces do for the business ("Shows buyers setup takes minutes"). Spread each pillar over the networks it fits, and set each share to the pillar\'s real count in the calendar (34 of 144 pieces is 24, not 20).',
  ],
  [
    "Leave a network out only when it clearly does not fit this buyer (a bakery on X, a payroll tool on Instagram), and then name it in leftOut with its channel key and why in at most 12 words, tied to the Brand Brain.",
    'Plan every live network at its rate, connected or not: the plan the owner buys decides how much of it is made. Leave a network out only when the owner asked you to, and then name it in leftOut with its channel key and a why that starts with "Owner:" ("Owner: no Facebook for now"); never for its audience or its account.',
  ],
  [
    'YouTube and TikTok take only video: each is in channels with the cadence "1 a week", and its pieces are the month\'s talking videos, which list it in alsoOn (see the talking video rule below); never plan a youtube or tiktok entry of its own beyond them.',
    "YouTube and TikTok take only video. A short video is made once and goes out on TikTok, Instagram Reels and YouTube Shorts together: plan it as one entry on one of them (tiktok format video, instagram format reel or youtube format short) that lists the other two in alsoOn; Core posts the one file on all three, each with its own caption in its network's format. The month's talking videos list them in alsoOn too.",
  ],
  [
    "all_in: three a day on X and two a day on LinkedIn, Facebook and Instagram.",
    "all_in: each network at its own rate, because each feed moves at its own speed: six a day on X, at least one in two with a picture; one a day on LinkedIn, never more, because its feed buries a company that posts often; two picture posts or carousels a day on Instagram; two a day on Facebook, pictures and Reels; and seven short videos a day, each one entry with alsoOn, so TikTok, Instagram Reels and YouTube Shorts each get all seven. A side network (another buyer) takes its network's rate too.",
  ],
  [
    "(the strategy review refuses more than three a day on X or two on another network, and more than three a week on a side channel)",
    "(the strategy review refuses more than a network's top rate)",
  ],
  [
    "So every main network takes its top rate (three a day on X, two on LinkedIn, Facebook and Instagram) and every side channel three a week;",
    "So every network takes its top rate (six a day on X, one on LinkedIn, two picture posts on Instagram, two on Facebook, and seven short videos a day shared by TikTok, Reels and Shorts), a side network too;",
  ],
  [
    "(all_in with Instagram as the main channel and LinkedIn as a side channel: 14 + 3 = 17)",
    "(all_in on X, LinkedIn, Instagram, TikTok and YouTube: 42 + 7 + 14 + 49 = 112 entries, the 49 short videos each on three networks)",
  ],
  [
    "(all_in on two main networks and a side channel is about 33 a week, not 7)",
    "(all_in on X, LinkedIn, Instagram, TikTok and YouTube is about 112 a week, not 17)",
  ],
  [
    "A video costs about 30 credits, as much as four pictures, so plan at most four a month, only where movement shows what a still picture cannot: a product in use, a before and after, a screen changing. The strategy review refuses more.",
    "A video costs about 30 credits, as much as four pictures, and short video is where people watch most: plan seven a day, each one entry with the other short-video networks in alsoOn, each showing something that moves: a product in use, a before and after, a screen changing, one step of a how-to.",
  ],
  [
    "It counts as one of the four videos and costs about",
    "Plan at most four a month: each costs about",
  ],
  [
    "A talking video is a Reel on Instagram and Facebook, a Short on YouTube and a vertical video on LinkedIn.",
    "A talking video is a Reel on Instagram and Facebook, a YouTube Short on YouTube, a TikTok on TikTok and a video on LinkedIn.",
  ],
  [
    "Plan up to four a month, about one a week, so YouTube and the other short-video feeds get one every week.",
    "Plan up to four a month, about one a week; the daily short videos fill the feeds between them.",
  ],
  [
    "One X post in three has an image you make;",
    "At least one X post in two has an image you make;",
  ],
  [
    "a play promises video only where a talking video in the calendar goes out (its channel or alsoOn)",
    "a play promises video only where a video in the calendar goes out (its channel or alsoOn)",
  ],
  [
    "Every channel in the strategy appears at the stage it serves, the talking videos where they explain (name them as videos in the play),",
    "Every channel in the strategy appears at the stage it serves, and every main network at awareness, where most of its posts reach new people; the videos where they explain, named as the platform names them (Reels, YouTube Shorts, TikToks);",
  ],
  [
    'When your work does not reach the stage, say so ("Nothing here: the order happens in your shop");',
    'At desire, show proof on a social network (customer results, comparisons, a walkthrough): a newsletter never carries a stage alone, because CMO cannot send it. At action, always plan offer posts that send people to the offer with its link, and say so ("I post the free-account offer with its link twice a week on X and LinkedIn"); never "Nothing here";',
  ],
  [
    "- Sound like the brand, not like AI:",
    '- Name every format the way its platform does, in titles, plays, whys and your answers: a Reel on Instagram and Facebook, a YouTube Short, a TikTok, a carousel, a thread on X, a Story. Never "talking video" or "short video" to the owner: those are only keys in the menu.\n- Sound like the brand, not like AI:',
  ],
];

/** `base` is cmo-v13's part-patch strategy skill. */
export function channelFitStrategy(base: SokoBotSkill): SokoBotSkill {
  const content = REVISIONS.reduce((text, [before, after]) => {
    if (!text.includes(before))
      throw new Error(
        `${CMO_CHANNEL_FIT_STRATEGY_SKILL}: "${before.slice(0, 60)}" is not in ${base.id}`,
      );
    return text.replace(before, after);
  }, base.content);
  return { ...base, id: CMO_CHANNEL_FIT_STRATEGY_SKILL, content };
}
