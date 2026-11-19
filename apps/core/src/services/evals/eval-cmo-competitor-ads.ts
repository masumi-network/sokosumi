import type { ScenarioCheck } from "@sokosumi/soko-bot";

import type { ComparisonSearch } from "@/lib/ads/dataforseo";
import prisma from "@/lib/db/prisma";
import { COMPARISON_SEARCHES_KIND } from "@/services/cmo-competitor-keywords.service";
import { findCusoForBot } from "@/services/cmo-cuso.service";
import { cmoSeoMarket } from "@/services/cmo-seo-market";
import { competitorNameKey } from "@/services/competitors.service";
import type { EvalLaneRecord } from "@/services/evals/eval-lanes.service";
import {
  approvedMarketingStrategy,
  listMarketingStrategyFiles,
  parseMarketingPlan,
} from "@/services/marketing-strategy.service";

export const COMPETITOR_ADS_CASE_ID = "cmo-competitor-search-ads";

/**
 * 20 a day: two search ads may each pay 3.33 a click, enough for "calendly
 * pricing" and "calendly alternatives"; a third would cap a click at 2.22,
 * under their lowest bids.
 */
const AD_BUDGET = { monthly: 600, currency: "USD" };
const FITTING = [
  "calendly pricing",
  "calendly alternatives",
  "alternative to calendly",
];
const ROOM_FOR = 2;

const search = (
  keyword: string,
  searchVolume: number,
  cpc: number | null,
  low: number | null,
  high: number | null,
): ComparisonSearch => ({
  keyword,
  searchVolume,
  cpc,
  lowTopOfPageBid: low,
  highTopOfPageBid: high,
  competition: "LOW",
});

/** What the search data provider returned for each competitor, 2026-11-19. */
const SEARCHES: Record<string, ComparisonSearch[]> = {
  Calendly: [
    search("calendly pricing", 4400, 8.88, 1.33, 15),
    search("calendly alternatives", 880, 22.63, 2.53, 18.37),
    search("alternative to calendly", 260, 12.01, 2.74, 20.24),
    search("calendly alternative free", 390, 12.15, 2.76, 20.1),
    search("cal.com vs calendly", 320, 21.91, 1.64, 10.13),
    search("calendly vs acuity", 320, 6.77, 2.17, 13.48),
    search("calendly free vs paid", 70, null, null, null),
    search("calendly stock price", 20, 22.32, null, null),
  ],
  SavvyCal: [
    search("savvycal vs calendly", 30, 46.48, 1.95, 17.17),
    search("savvycal pricing", 20, 25.72, null, null),
  ],
  Zcal: [],
};

const flat = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * The lane's Cuso runs an approved month with an ad budget, and the search
 * data for his three competitors is stored, so the case pays for no read.
 * Call it after the competitors are on the watch list.
 */
export async function prepareCompetitorAdsCase(
  lane: EvalLaneRecord,
): Promise<void> {
  const projectId = lane.cusoProjectId;
  const cuso = await findCusoForBot(lane.cusoBotId);
  if (!cuso) throw new Error(`Eval lane ${lane.lane} has no Cuso`);
  const market = await cmoSeoMarket(cuso);
  await prisma.projectSeoResearch.deleteMany({
    where: { projectId, kind: COMPARISON_SEARCHES_KIND },
  });
  await prisma.projectSeoResearch.createMany({
    data: Object.entries(SEARCHES).map(([name, searches]) => ({
      projectId,
      kind: COMPARISON_SEARCHES_KIND,
      key: `${competitorNameKey(name)}|${market.countryCode}|${market.languageCode}`,
      payload: {
        name,
        countryCode: market.countryCode,
        languageCode: market.languageCode,
        searches,
      },
      observedAt: new Date(),
    })),
  });
  const month = await prisma.marketingStrategy.findFirstOrThrow({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  const plan = parseMarketingPlan(month.plan);
  if (!plan) throw new Error("The lane's month does not parse");
  await prisma.marketingStrategy.update({
    where: { id: month.id },
    data: {
      approvedAt: new Date(),
      approvedByUserId: lane.userId,
      plan: {
        ...plan,
        ads: {
          ...AD_BUDGET,
          expect: "Sign-ups from people comparing schedulers.",
          without: "The month stays organic.",
          setByOwner: true,
        },
      },
    },
  });
}

/** The search ads the case left in the approved month. */
export async function competitorAdChecks(
  lane: EvalLaneRecord,
): Promise<ScenarioCheck[]> {
  const approved = await approvedMarketingStrategy(lane.cusoProjectId);
  const files = approved ? await listMarketingStrategyFiles(approved) : null;
  const calendar = parseMarketingPlan(approved?.plan)?.calendar ?? [];
  const ads = [...(files ?? [])].flatMap(([entryId, file]) =>
    file.searchAd ? [{ entryId, ad: file.searchAd }] : [],
  );
  const fitting = new Set(FITTING.map(flat));
  const keywords = ads.flatMap(({ ad }) => ad.keywords);
  const unfit = keywords.filter((keyword) => !fitting.has(flat(keyword)));
  const unnamed = ads.filter(
    ({ ad }) =>
      !ad.headlines.some((headline) =>
        ad.keywords.some((keyword) => flat(headline).includes(flat(keyword))),
      ),
  );
  const unplanned = ads.filter(
    ({ entryId }) =>
      !calendar.some(
        (entry) => entry.id === entryId && entry.channel === "google_ads",
      ),
  );
  return [
    {
      label: "Writes search ads into the approved month",
      pass: ads.length > 0,
      actual: `${ads.length} search ads`,
    },
    {
      label: `Writes no more ads than the budget carries (${ROOM_FOR})`,
      pass: ads.length <= ROOM_FOR,
      actual: `${ads.length} search ads`,
    },
    {
      label: "Uses only searches the read marked as fitting the budget",
      pass: ads.length > 0 && unfit.length === 0,
      actual: unfit.length > 0 ? unfit.join(", ") : keywords.join(", "),
    },
    {
      label: "Repeats each group's search in a headline",
      pass: ads.length > 0 && unnamed.length === 0,
      actual:
        unnamed.map(({ ad }) => ad.headlines.join(" / ")).join("; ") ||
        "every ad",
    },
    {
      label: "Puts each ad in the calendar, where the owner launches it",
      pass: ads.length > 0 && unplanned.length === 0,
      actual: `${ads.length - unplanned.length} of ${ads.length} planned`,
    },
  ];
}
