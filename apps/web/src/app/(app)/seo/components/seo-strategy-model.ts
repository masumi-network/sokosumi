import type { ProjectSeoStrategy } from "@sokosumi/core-client";
import { normalizeQuery } from "./seo-search-model";

export type SeoStrategyGroup = ProjectSeoStrategy["groups"][number];
type Strategy = ProjectSeoStrategy | null | undefined;

/**
 * The SEO bot's words and their message keys.
 * A word from a newer bot has no key, and the view then shows the word as it came.
 */
export const SEO_STRATEGY_VERDICTS = {
  keep: "keep",
  "out of reach": "outOfReach",
  "low demand": "lowDemand",
  "not determined": "notDetermined",
  narrow: "narrow",
  move: "move",
  "no fit": "noFit",
} as const;
export const SEO_STRATEGY_REACHES = {
  ranks: "ranks",
  "in reach": "inReach",
  open: "open",
  "out of reach": "outOfReach",
  "not determined": "notDetermined",
} as const;
export const SEO_STRATEGY_ACTION_KINDS = {
  "get listed": "getListed",
  "new page": "newPage",
  "retarget page": "retargetPage",
  promote: "promote",
} as const;
/** What the owner does at the place of a promotion action. */
export const SEO_STRATEGY_PLACE_FORMS = {
  community: "community",
  launch: "launch",
  listing: "listing",
  post: "post",
  article: "article",
  video: "video",
} as const;
export const SEO_STRATEGY_TARGET_TYPES = {
  "app store": "appStore",
  directory: "directory",
  forum: "forum",
  listicle: "list",
  video: "video",
} as const;
/** "not read" says nothing about the page, so it has no label. */
export const SEO_STRATEGY_TARGET_STATES = {
  links: "links",
  "mentioned without a link": "mentioned",
  "not mentioned": "notMentioned",
} as const;
/**
 * The bot ends the reason of these verdicts with the sentence about the niche, and starts that sentence this way.
 * A niche name can hold a full stop, so the split is not at one.
 */
const NICHE_OPENERS = {
  narrow: 'The narrower niche "',
  move: 'The near market "',
  "no fit": "None of the ",
} as const;
/** Each keyword's clause starts with the keyword in quotes. A keyword can hold "; ". */
const NEXT_KEYWORD = /; (?=")/;
/** The bot's sentence about the keyword groups it could not count. It follows the keywords' numbers. */
const LEFT_OUT = /\d+ of \d+ keyword groups are left out[\s\S]*$/;
/** A position already says that the page ranks, so this reach adds nothing under a keyword. */
const REACH_RANKS = "ranks";

export function seoStrategyKey<Keys extends Record<string, string>>(
  keys: Keys,
  word: string,
): Keys[keyof Keys] | null {
  return Object.hasOwn(keys, word) ? keys[word as keyof Keys] : null;
}

/**
 * The reason in parts. The first sentence gives the result. For a verdict about a niche,
 * the last sentence names the niche. The clauses between them give one keyword's numbers each,
 * and the sentence about the groups left out is a line of its own.
 * Text in a form this does not know stays in the details, so nothing is lost.
 */
export function seoStrategyReason({
  verdict,
  why,
}: Pick<ProjectSeoStrategy, "verdict" | "why">) {
  const lead = /^[\s\S]*?[.!?](?=\s|$)/.exec(why)?.[0] ?? why;
  let rest = why.slice(lead.length).trim();
  let niche: string | null = null;
  const opener = seoStrategyKey(NICHE_OPENERS, verdict);
  const start = opener ? rest.lastIndexOf(opener) : -1;
  if (start >= 0) {
    niche = rest.slice(start);
    rest = rest.slice(0, start).trim();
  }
  const leftOut = LEFT_OUT.exec(rest)?.[0];
  if (leftOut) rest = rest.slice(0, -leftOut.length).trim();
  return {
    lead,
    niche,
    details: [
      ...(rest ? rest.split(NEXT_KEYWORD) : []),
      ...(leftOut ? [leftOut] : []),
    ],
  };
}

/**
 * Finds the keyword group of a ranking row. Every keyword of a group leads to it.
 * The audit read one Market, so a row of another Market has no group.
 */
export function seoStrategyGroupOf(strategy: Strategy) {
  const index = new Map<string, SeoStrategyGroup>();
  for (const group of strategy?.groups ?? [])
    for (const keyword of [group.lead, ...group.keywords]) {
      const key = normalizeQuery(keyword);
      if (!index.has(key)) index.set(key, group);
    }
  return (row: {
    keyword: string;
    countryCode: string;
    languageCode: string;
  }) =>
    strategy &&
    (strategy.countryCode ?? row.countryCode) === row.countryCode &&
    (strategy.languageCode ?? row.languageCode) === row.languageCode
      ? index.get(normalizeQuery(row.keyword))
      : undefined;
}

/**
 * What a keyword's group adds under the keyword: its reach, and the recent searches when they move.
 * The group's searches are those of its biggest keyword, so only that keyword shows them.
 */
export function seoKeywordDemand(
  group: SeoStrategyGroup | undefined,
  keyword: string,
) {
  if (!group) return null;
  const reach = group.reach === REACH_RANKS ? null : group.reach;
  const trend =
    normalizeQuery(keyword) === normalizeQuery(group.lead) &&
    group.recent !== null &&
    (group.trend === "falling" || group.trend === "rising")
      ? { direction: group.trend, recent: group.recent }
      : null;
  return reach || trend ? { reach, trend } : null;
}

/** How many keyword groups each reach holds, most first, and how many lose searches. */
export function seoStrategyCounts(groups: SeoStrategyGroup[]) {
  const reaches = new Map<string, number>();
  for (const group of groups)
    reaches.set(group.reach, (reaches.get(group.reach) ?? 0) + 1);
  return {
    reaches: [...reaches]
      .map(([reach, count]) => ({ reach, count }))
      .sort((a, b) => b.count - a.count),
    falling: groups.filter((group) => group.trend === "falling").length,
  };
}

/** The site a place's link opens, or null when the name is that site. */
export function seoStrategyPlaceHost(
  place: NonNullable<ProjectSeoStrategy["actions"][number]["place"]>,
) {
  if (!URL.canParse(place.url)) return null;
  const host = new URL(place.url).hostname
    .replace(/^www\./, "")
    .replace(/\.+$/, "");
  // Only the whole name counts: "reddit.com" holds "t.co", and the link could open t.co.
  return !host || place.name.trim().toLowerCase() === host ? null : host;
}

/** The notes beside a target link: its page type and whether it names the product, as message keys. */
export function seoStrategyTargetNotes(
  target: ProjectSeoStrategy["actions"][number]["targets"][number],
) {
  return {
    type: seoStrategyKey(SEO_STRATEGY_TARGET_TYPES, target.type),
    state: target.state
      ? seoStrategyKey(SEO_STRATEGY_TARGET_STATES, target.state)
      : null,
  };
}
