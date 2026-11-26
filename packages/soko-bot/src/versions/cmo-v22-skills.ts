import type { SokoBotSkill } from "./skills.js";

/**
 * cmo-v22's strategy skill: cmo-v21's with a few example posts instead of
 * the month's calendar, which Core writes once the owner has paid.
 */
export const CMO_V22_STRATEGY_SKILL = "cmo-strategy-v22";

/** How many example posts a cmo-v22 strategy shows before payment. */
export const CMO_STRATEGY_EXAMPLES = { min: 3, max: 5 } as const;

/** Whether a Cuso version leaves the month's calendar to Core after payment (cmo-v22). */
export function cmoWritesExamplesOnly(skills: readonly string[]): boolean {
  return skills.includes(CMO_V22_STRATEGY_SKILL);
}

const CALENDAR_START = "- calendar: every piece, day by day, for four weeks";
const CALENDAR_END = "\n- drafts, when you produce them";

/**
 * Owner, 2026-11-25: a strategy took 15 to 20 minutes and about $3 before
 * payment, even for people who never paid, because Cuso wrote every post of
 * the month into it. The plan and a few real examples are what the owner
 * decides on; Core writes the rest after payment, in parallel.
 */
const EXAMPLES_BULLET = `- calendar: only example posts, ${CMO_STRATEGY_EXAMPLES.min} to ${CMO_STRATEGY_EXAMPLES.max}, so the owner sees what they get before they pay. Once the owner approves and pays, Core writes the whole month from this strategy, sized to the plan they buy: every network at its rate, each pillar at its share, each approach at the mix's share and every funnel step, and it keeps your examples in the month word for word. So never plan the month yourself, never count a cadence into the calendar, and never ask the owner about the volume. Choose the examples to show the strategy's range: each on a different pillar (every pillar once when there are enough examples), on at least three different networks when the strategy has three, in different formats, approaches and funnel steps, and one of them a short video (a TikTok, a Reel or a YouTube Short, with the other short-video networks in alsoOn) when the strategy has a short-video network. Date them in week one, from the start date. Each example has date, time (HH:MM), channel, format, status idea, approach, pillar (named exactly as in pillars), stage, campaignId when it belongs to a campaign, title (at most eight words in the contentLanguage, making its own point), brief (one or two lines on what the post says and shows, specific to this business, naming its material, and the industryResearch id when it rests on one), why (which goal or pillar it serves), claim (the one sentence it argues) and story when it is built on proof. Proof is clearly positive and comes only from the Brand Brain. No draft and no hook: Core makes every post, its words and its picture or video, once the owner pays.`;

const SAVE_FROM =
  "Send the calendar in calls of its own: it is the longest part. A whole month does not fit one call: save week one with part calendar, then each later week with part patch (only that week's entries, each with a new id; a new id adds an entry and every saved one stays). Every week holds about perWeek entries in the mix and pillar shares: count them before you save (all_in on X, LinkedIn, Instagram, TikTok and YouTube is about 112 a week, not 17). A week too long for one call goes in two part patch calls. The strategy review asks for the weeks still missing until all four are in. A new month replaces the saved one: save its week one with part calendar, never patch last month's entries. When a save is refused or the review names problems, fix them and save again in the same turn: never end the turn while the calendar misses a week.";
const SAVE_TO =
  "Save the example posts with part calendar in one call after the plan: a new strategy replaces the saved one's calendar, never patch last month's entries. Before payment the calendar holds only the examples: a change to how often a network posts sets its cadence and the pace, and Core writes the month at it, so leave the examples as they are for it. When a save is refused or the review names problems, fix them and save again in the same turn.";

const HARD_FROM =
  "save_strategy refuses a save that breaks a hard rule (a summary of at most 20 words, at least 16 pieces, approach and pillar shares within 7 points) and names the rule: nothing was saved, so fix it and save again.";
const HARD_TO =
  "save_strategy refuses a save that breaks a hard rule (a summary of at most 20 words) and names the rule: nothing was saved, so fix it and save again. Once Core has written the month, its approach and pillar shares stay within 7 points of the mix and the pillars.";

const PACE_FROM = "The calendar holds about four times perWeek pieces.";
const PACE_TO =
  "Core writes the calendar after payment at the rates of the plan the owner buys.";

const PILLAR_FROM =
  "Spread each pillar over the networks it fits, and set each share to the pillar's real count in the calendar (34 of 144 pieces is 24, not 20).";
const PILLAR_TO =
  "Set each share to how much of the month the pillar should get: Core writes every network's posts to these shares after payment, and they decide what the month is about, so choose them on purpose.";

const VIDEO_FROM =
  "a play promises video only where a video in the calendar goes out (its channel or alsoOn), and the strategy review compares them.";
const VIDEO_TO =
  "the month Core writes always holds the short videos (TikToks, Reels and YouTube Shorts, every day) and talking videos (one short video in four; up to half of Facebook's posts are talking Reels; one a week also on LinkedIn), so a play may promise them on those networks.";

const STAGE_FROM =
  "Give each calendar entry the funnel step it serves in stage: awareness, interest, desire or action. Spread each network's pieces across the steps; the share of the month at each step is what the owner sees in the funnel, so plan it on purpose (most pieces help people find out and look, fewer ask for the offer). The strategy review refuses an entry without a stage and a network whose pieces all serve one step.";
const STAGE_TO =
  "Give each example the funnel step it serves in stage: awareness, interest, desire or action, and spread the examples across the steps. Core writes the month across every step on every network after payment: most posts help people find out and look, fewer ask for the offer.";

const PLENTY_FROM =
  "- Plan plenty, and plan variety. A founder hires you to show up everywhere their buyers are, every day: the pace sets how many pieces a day each network gets, and two to four ads go in when the strategy has an ads channel. Use at least six different formats across the month and at least two on every social channel.";
const PLENTY_TO =
  "- Show variety in the examples. A founder hires you to show up everywhere their buyers are, every day: the pace and the plan they buy set how many posts a day each network gets, and Core writes that many, in many formats, after payment. Your examples show the range: different networks, formats, pillars and steps.";

function swap(content: string, from: string, to: string): string {
  if (!content.includes(from))
    throw new Error(`cmo-v22's strategy no longer finds: ${from.slice(0, 60)}`);
  return content.replaceAll(from, to);
}

/** `v21Strategy` is cmo-v21's strategy skill; its month calendar becomes examples. */
export function cmoV22Strategy(v21Strategy: SokoBotSkill): SokoBotSkill {
  const start = v21Strategy.content.indexOf(CALENDAR_START);
  const end = v21Strategy.content.indexOf(CALENDAR_END, start);
  if (start < 0 || end < 0)
    throw new Error("cmo-v22's strategy no longer finds cmo-v21's calendar");
  const content = [
    [SAVE_FROM, SAVE_TO],
    [HARD_FROM, HARD_TO],
    [PACE_FROM, PACE_TO],
    [PILLAR_FROM, PILLAR_TO],
    [VIDEO_FROM, VIDEO_TO],
    [STAGE_FROM, STAGE_TO],
    [PLENTY_FROM, PLENTY_TO],
  ].reduce(
    (text, [from, to]) => swap(text, from!, to!),
    `${v21Strategy.content.slice(0, start)}${EXAMPLES_BULLET}${v21Strategy.content.slice(end)}`,
  );
  return { ...v21Strategy, id: CMO_V22_STRATEGY_SKILL, content };
}
