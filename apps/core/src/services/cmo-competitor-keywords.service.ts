import { z } from "zod";

import {
  type ComparisonSearch,
  comparisonSearchSchema,
  fetchComparisonSearches,
} from "@/lib/ads/dataforseo";
import prisma from "@/lib/db/prisma";
import { tryUseLogger } from "@/lib/evlog";
import { cmoSearchAdBudget } from "@/services/cmo-ads.service";
import type { Cuso } from "@/services/cmo-cuso.service";
import { cmoSeoMarket } from "@/services/cmo-seo-market";
import {
  competitorNameKey,
  listTrackedCompetitors,
} from "@/services/competitors.service";

/** A competitor's searches are read again after a week. */
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
export const COMPARISON_SEARCHES_KIND = "comparison_searches";
/** The searches of one competitor Cuso reads. */
const SEARCHES_SHOWN = 12;
/** A day's share of the ad budget buys at least this many clicks. */
const MIN_CLICKS_PER_DAY = 3;

export type ComparisonKind = "versus" | "alternative" | "pricing";

/** "x alternative vs y" is a comparison first, so the order decides. */
const KIND_WORDS: [ComparisonKind, RegExp][] = [
  ["versus", /\b(vs|versus|compared)\b/],
  ["alternative", /\b(alternativ\w*|competitors?)\b/],
  ["pricing", /\b(pricing|prices?|costs?)\b/],
];
/** Searches that hold a comparison word and are about something else. */
const NOT_A_BUYER = /\b(reddit|quora|stock|shares?|login|jobs?|careers?)\b/;

const payloadSchema = z.object({
  name: z.string(),
  countryCode: z.string(),
  languageCode: z.string(),
  searches: z.array(comparisonSearchSchema),
});

export interface CmoCompetitorSearch extends ComparisonSearch {
  kind: ComparisonKind;
  /** The same search in other words, for the same ad group. */
  alsoSearchedAs: string[];
  /** Whether the ad budget pays for clicks on it: an ad is worth writing. */
  fitsBudget: boolean;
}

export interface CmoCompetitorKeywords {
  countryCode: string;
  languageCode: string;
  competitors: {
    name: string;
    /** When the searches were read; null when the read failed. */
    observedAt: string | null;
    searches: CmoCompetitorSearch[];
  }[];
  /** What the approved strategy lets search ads spend; null without a budget. */
  adBudget: {
    currency: string;
    perDay: number;
    /** Search ads already written; each gets an equal share of the day. */
    searchAds: number;
    /** How many of the searches marked fitsBudget can each get an ad. */
    roomFor: number;
  } | null;
}

/**
 * What a search that names a competitor asks for: another product, a
 * comparison or the price. Null when it is not a buyer's search.
 */
export function comparisonKind(keyword: string): ComparisonKind | null {
  const text = keyword.toLowerCase();
  if (NOT_A_BUYER.test(text)) return null;
  return KIND_WORDS.find(([, words]) => words.test(text))?.[0] ?? null;
}

/** Words that change nothing about what a search asks for. */
const FILLER = new Set(["to", "the", "a", "an", "for", "of"]);
/** The most ways of saying one search an ad group takes. */
const VARIANTS_KEPT = 4;

/** Words that ask the same thing: one ad answers all of them. */
const SAME_WORD: Record<string, string> = {
  pricing: "price",
  prices: "price",
  cost: "price",
  costs: "price",
  alternatives: "alternative",
  competitor: "alternative",
  competitors: "alternative",
  versus: "vs",
};

/** One key for a search however it is worded: its words, singular, sorted. */
function meaningKey(keyword: string): string {
  return keyword
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !FILLER.has(word))
    .map(
      (word) =>
        SAME_WORD[word] ?? (word.length > 3 ? word.replace(/s$/, "") : word),
    )
    .sort()
    .join(" ");
}

/**
 * The buyer's searches with a volume, most searched first, each once: the
 * ways of wording one search ("calendly pricing", "calendly cost", "price of
 * calendly") are one row, under its most searched wording.
 */
function sorted(searches: ComparisonSearch[]): CmoCompetitorSearch[] {
  const rows = new Map<string, CmoCompetitorSearch>();
  for (const search of searches) {
    const kind = comparisonKind(search.keyword);
    if (!kind || !search.searchVolume) continue;
    const key = meaningKey(search.keyword);
    const row = rows.get(key);
    if (!row)
      rows.set(key, { ...search, kind, alsoSearchedAs: [], fitsBudget: false });
    else if (row.alsoSearchedAs.length < VARIANTS_KEPT)
      row.alsoSearchedAs.push(search.keyword);
  }
  return [...rows.values()].slice(0, SEARCHES_SHOWN);
}

/** The most search ads one request adds. */
const ADS_MAX = 6;

/**
 * Marks the searches the daily budget pays for, most searched first: each
 * search ad gets an equal share of the day, and a click may cost a third of
 * that share at most, so a search joins only while every chosen search's
 * lowest top-of-page bid still fits under that cap. Prices are USD; a budget
 * in another currency is compared as it stands.
 */
function markFitting(
  searches: CmoCompetitorSearch[],
  budget: { perDay: number; searchAds: number } | null,
): number {
  if (!budget) return 0;
  const byVolume = [...searches].sort(
    (a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0),
  );
  let chosen = 0;
  let dearest = 0;
  for (const search of byVolume) {
    const bid = search.lowTopOfPageBid ?? search.cpc;
    if (bid === null || chosen >= ADS_MAX) continue;
    const cap =
      budget.perDay / (budget.searchAds + chosen + 1) / MIN_CLICKS_PER_DAY;
    if (Math.max(dearest, bid) > cap) continue;
    search.fitsBudget = true;
    dearest = Math.max(dearest, bid);
    chosen += 1;
  }
  return chosen;
}

/**
 * The searches people make when they weigh a tracked competitor against
 * others ("x alternative", "x vs y", "x pricing"), each with its monthly
 * searches and what an ad on it costs, from DataForSEO Labs: one read per
 * competitor, used again for a week. A competitor whose read failed is
 * listed without searches.
 */
export async function readCmoCompetitorKeywords(
  cuso: Cuso,
  now: Date = new Date(),
): Promise<CmoCompetitorKeywords> {
  const [market, competitors, budget] = await Promise.all([
    cmoSeoMarket(cuso),
    listTrackedCompetitors(cuso.projectId),
    cmoSearchAdBudget(cuso),
  ]);
  const read = await Promise.all(
    competitors.map(async (competitor) => {
      const key = `${competitorNameKey(competitor.name)}|${market.countryCode}|${market.languageCode}`;
      const where = {
        projectId_kind_key: {
          projectId: cuso.projectId,
          kind: COMPARISON_SEARCHES_KIND,
          key,
        },
      };
      const cached = await prisma.projectSeoResearch.findUnique({
        where,
        select: { payload: true, observedAt: true },
      });
      const fresh =
        cached && now.getTime() - cached.observedAt.getTime() < CACHE_MS
          ? payloadSchema.safeParse(cached.payload)
          : null;
      if (fresh?.success)
        return {
          name: competitor.name,
          observedAt: cached!.observedAt.toISOString(),
          searches: sorted(fresh.data.searches),
        };
      try {
        const searches = await fetchComparisonSearches({
          product: competitor.name.toLowerCase(),
          locationCode: market.locationCode,
          languageCode: market.languageCode,
        });
        const payload = {
          name: competitor.name,
          countryCode: market.countryCode,
          languageCode: market.languageCode,
          searches,
        };
        await prisma.projectSeoResearch.upsert({
          where,
          create: {
            projectId: cuso.projectId,
            kind: COMPARISON_SEARCHES_KIND,
            key,
            payload,
            observedAt: now,
          },
          update: { payload, observedAt: now },
        });
        return {
          name: competitor.name,
          observedAt: now.toISOString(),
          searches: sorted(searches),
        };
      } catch (error) {
        tryUseLogger()?.set({
          cmoCompetitorSearches: {
            failed: competitor.name,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        return { name: competitor.name, observedAt: null, searches: [] };
      }
    }),
  );
  const roomFor = markFitting(
    read.flatMap((competitor) => competitor.searches),
    budget,
  );
  return {
    countryCode: market.countryCode,
    languageCode: market.languageCode,
    competitors: read,
    adBudget: budget && { ...budget, roomFor },
  };
}
