import type { ProjectSeoStrategy } from "@sokosumi/core-client";

type Action = ProjectSeoStrategy["actions"][number];
type Target = Action["targets"][number];

/** How easy a place is to get onto: who decides that the product shows there. */
export type SeoPlaceEase = "easy" | "medium" | "hard";
/**
 * Why a place has its ease, as message keys. text: you post, and the audit wrote the text. self: you post or submit
 * it yourself. answer: only as an answer to a question it fits. review: a store reviews the app. mention: the page
 * names the product already, so a link is a small ask. author: the page's author decides.
 */
export type SeoPlaceReason =
  | "text"
  | "self"
  | "answer"
  | "review"
  | "mention"
  | "author";

export interface SeoPlace {
  key: string;
  name: string;
  /** The action of this one place: a listing action keeps only this page as its target. */
  action: Action;
  ease: SeoPlaceEase;
  reason: SeoPlaceReason;
  /** How many of the audit's SERP reads show the place; null where the audit gave no count. */
  reads: { seen: number; total: number } | null;
}

const EASE_ORDER: Record<SeoPlaceEase, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
};
const REASON_EASE: Record<SeoPlaceReason, SeoPlaceEase> = {
  text: "easy",
  self: "easy",
  answer: "hard",
  review: "medium",
  mention: "medium",
  author: "hard",
};
/** The bot's kinds of the actions that put the product on another site. */
const PROMOTE = "promote";
const GET_LISTED = "get listed";
/** The bot's reason of a community: "9 threads of X are in 11 of 23 SERP reads for keywords ...". */
const COMMUNITY_READS = /\b(?:are|is) in (\d+) of (\d+) SERP reads?\b/;
/**
 * The bot's reason of a community also counts its own searches with "forum" or "reddit" added: they find forums by
 * design, so they are no evidence that people searching the site's keywords see the place.
 */
const OWN_SEARCHES = /\b(\d+) of these reads (?:is|are) the audit's own search/;
/** The bot's reason of a listing action names the count of all reads: "... of the start page's 23 SERP reads." */
const ALL_READS = /\b(\d+) SERP reads?\b/;
/** One deciding SERP has no number: "... of the start page's SERP read." */
const ONE_READ = /\bSERP read\b/;
/** The bot's title of a question and answer site, where the product shows only in an answer. */
const ANSWER_ONLY = /^Answer a question on /;
/** A list that links to the site has nothing left to ask. */
const LINKS = "links";
const MENTIONED = "mentioned without a link";
const PAGE_REASONS: Record<string, SeoPlaceReason> = {
  directory: "self",
  "app store": "review",
  listicle: "author",
};

function communityReads(why: string) {
  const match = COMMUNITY_READS.exec(why);
  if (!match) return null;
  const own = Number(OWN_SEARCHES.exec(why)?.[1] ?? 0);
  const [seen, total] = [Number(match[1]) - own, Number(match[2]) - own];
  return seen > 0 && seen <= total ? { seen, total } : null;
}

function pageReads(target: Target, why: string) {
  const total = Number(
    ALL_READS.exec(why)?.[1] ?? (ONE_READ.test(why) ? 1 : 0),
  );
  const seen = target.serps ?? null;
  return seen !== null && total > 0 && seen <= total ? { seen, total } : null;
}

function promotePlace(action: Action, index: number): SeoPlace {
  const reason: SeoPlaceReason = ANSWER_ONLY.test(action.title)
    ? "answer"
    : action.draft
      ? "text"
      : "self";
  return {
    key: `${index}:${action.place?.url ?? action.title}`,
    name: action.place?.name ?? action.title,
    action,
    ease: REASON_EASE[reason],
    reason,
    reads: communityReads(action.why),
  };
}

function listingPlaces(action: Action, index: number): SeoPlace[] {
  return action.targets.flatMap((target) => {
    if (target.state === LINKS) return [];
    const reason: SeoPlaceReason =
      target.state === MENTIONED
        ? "mention"
        : // A page of a kind this does not know: who decides is not known, so it does not rank as easy.
          (PAGE_REASONS[target.type] ?? "author");
    return [
      {
        key: `${index}:${target.url}`,
        name: target.title ?? target.url,
        // The reason counts all pages of the kind; one page's row says its own count.
        action: { ...action, why: "", targets: [target] },
        ease: REASON_EASE[reason],
        reason,
        reads: pageReads(target, action.why),
      },
    ];
  });
}

// A community counts the reads of keywords the site does not rank for, a listing all reads of the page: the totals
// differ, so the count of searches that show a place is what compares.
const seen = (place: SeoPlace) => place.reads?.seen ?? -1;

/**
 * The places of the strategy where the product can show and get a link: each community and each page of a listing
 * action, easiest first, then the ones that more of the audit's searches show. The other actions stay as they came.
 */
export function seoPlaces(actions: readonly Action[]) {
  const places: SeoPlace[] = [];
  const rest: Action[] = [];
  actions.forEach((action, index) => {
    if (action.kind === PROMOTE) places.push(promotePlace(action, index));
    else if (action.kind === GET_LISTED && listingPlaces(action, index).length)
      places.push(...listingPlaces(action, index));
    // A listing without pages (an app store, a business profile) is a step of its own.
    else rest.push(action);
  });
  return {
    // Stable: equal places keep the bot's order, which lists the most read pages first.
    places: places.toSorted(
      (left, right) =>
        EASE_ORDER[left.ease] - EASE_ORDER[right.ease] ||
        seen(right) - seen(left),
    ),
    rest,
  };
}

/** The rows of the strategy: its other actions and its places. The rows that lead there count these. */
export function seoStrategyRows(
  strategy: ProjectSeoStrategy | null | undefined,
) {
  const { places, rest } = seoPlaces(strategy?.actions ?? []);
  return places.length + rest.length;
}
