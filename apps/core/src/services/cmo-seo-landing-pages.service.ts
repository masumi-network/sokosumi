import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { z } from "zod";

import { readCompetitorPage } from "@/lib/competitors/page-read";
import { bareHost } from "@/lib/competitors/text";
import prisma from "@/lib/db/prisma";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import {
  flat,
  landingPageProblems,
  unsupportedCompetitorClaims,
} from "@/lib/seo/landing-page-check";
import type { Cuso } from "@/services/cmo-cuso.service";
import {
  competitorNameKey,
  listTrackedCompetitors,
} from "@/services/competitors.service";

/** How many of a competitor's pages one save reads to check its quotes. */
const PAGES_READ_MAX = 4;

const claimSchema = z.object({
  /** What the page says about the competitor. */
  text: z.string().trim().min(5).max(300),
  /** Where the competitor says it: its own site, or a stored signal's source. */
  sourceUrl: z.string().url().max(500),
  /** The competitor's own words there, copied. */
  quote: z.string().trim().min(8).max(500),
});
export type CmoLandingPageClaim = z.infer<typeof claimSchema>;

export type CmoSeoLandingPageInput = NonNullable<
  z.infer<
    typeof SOKO_BOT_TOOL_INPUT_SCHEMAS.save_seo_suggestions
  >["landingPages"]
>[number];

/** The stored sources of a landing page, read back for the SEO tab. */
export function landingPageSources(body: string): CmoLandingPageClaim[] {
  try {
    const parsed = z.array(claimSchema).safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

const sameAddress = (a: string, b: string | null) => {
  const [left, right] = [URL.parse(a), b ? URL.parse(b) : null];
  return (
    left !== null &&
    right !== null &&
    bareHost(left.hostname) === bareHost(right.hostname) &&
    left.pathname.replace(/\/$/, "") === right.pathname.replace(/\/$/, "")
  );
};

/**
 * Each claim whose quote is not where it says: the competitor's words must
 * stand in a signal the weekly check stored for that address, or on that
 * page of the competitor's own site as Core reads it now.
 */
async function quoteProblems(
  competitor: { id: string; name: string; websiteUrl: string | null },
  claims: readonly CmoLandingPageClaim[],
): Promise<string[]> {
  const signals = await prisma.competitorSignal.findMany({
    where: { competitorId: competitor.id, sourceUrl: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { sourceUrl: true, quote: true, summary: true },
  });
  const site = competitor.websiteUrl
    ? URL.parse(competitor.websiteUrl)?.hostname
    : null;
  const pages = new Map<string, Promise<string | null>>();
  const pageText = (url: string) => {
    const read =
      pages.get(url) ??
      readCompetitorPage(url)
        .then((page) => (page ? flat(page.lines.join(" ")) : null))
        .catch(() => null);
    pages.set(url, read);
    return read;
  };
  const problems: string[] = [];
  for (const claim of claims) {
    const quote = flat(claim.quote);
    const stored = signals.filter((signal) =>
      sameAddress(claim.sourceUrl, signal.sourceUrl),
    );
    if (
      stored.some((signal) =>
        flat(`${signal.quote ?? ""} ${signal.summary}`).includes(quote),
      )
    )
      continue;
    const host = URL.parse(claim.sourceUrl)?.hostname;
    if (!site || !host || bareHost(host) !== bareHost(site)) {
      problems.push(
        stored.length > 0
          ? `"${claim.quote}" is not in what the weekly check stored for ${claim.sourceUrl}. Copy the words check_competitors returned.`
          : `${claim.sourceUrl} is neither ${competitor.name}'s own site nor a source the weekly check stored. Cite ${competitor.name}'s own page.`,
      );
      continue;
    }
    if (!pages.has(claim.sourceUrl) && pages.size >= PAGES_READ_MAX) {
      problems.push(
        `Cite at most ${PAGES_READ_MAX} pages of ${competitor.name}; ${claim.sourceUrl} is one more.`,
      );
      continue;
    }
    const text = await pageText(claim.sourceUrl);
    if (text === null)
      problems.push(
        `${claim.sourceUrl} could not be read, so "${claim.quote}" could not be checked. Cite another page of ${competitor.name}.`,
      );
    else if (!text.includes(quote))
      problems.push(
        `"${claim.quote}" is not on ${claim.sourceUrl}. Copy ${competitor.name}'s words exactly as the page has them.`,
      );
  }
  return problems;
}

/**
 * What keeps a landing page from being saved, and what checking it cost: the
 * competitor is on the watch list, each cited quote is where it says, the
 * search is in the H1 and the first paragraph, no number beside the
 * competitor's name lacks a source, and Jev finds nothing about the
 * competitor its cited words do not say. An unchecked page is refused too.
 */
export async function checkCmoLandingPage(
  cuso: Cuso,
  page: CmoSeoLandingPageInput,
): Promise<{ problems: string[]; costUsd: number }> {
  const competitor = (await listTrackedCompetitors(cuso.projectId)).find(
    (row) => competitorNameKey(row.name) === competitorNameKey(page.competitor),
  );
  if (!competitor)
    return {
      problems: [
        `${page.competitor} is not on the competitor watch list. Name a competitor from research_competitor_keywords.`,
      ],
      costUsd: 0,
    };
  const brandBrain = await prisma.brandBrain.findUnique({
    where: { projectId: cuso.projectId },
    select: { body: true },
  });
  const quotes = page.claims.map((claim) => claim.quote);
  const problems = [
    ...(await quoteProblems(competitor, page.claims)),
    ...landingPageProblems({
      keyword: page.keyword,
      draft: page.draft,
      competitor: competitor.name,
      quotes,
      ownFacts: JSON.stringify(brandBrain?.body ?? {}),
    }),
  ];
  if (problems.length > 0) return { problems, costUsd: 0 };
  try {
    return await unsupportedCompetitorClaims({
      draft: page.draft,
      competitor: competitor.name,
      quotes,
    });
  } catch (error) {
    recordCoreWarning(
      { operation: "cmo_landing_page", project: { id: cuso.projectId } },
      {
        message: "Could not check a landing page",
        why: "Jev did not answer for what the page says about a competitor",
        fix: "Nothing was saved; Cuso is told to save again. If it repeats, look up the error name and code under failure.",
      },
      { failure: messageSafeErrorFields(error) },
    );
    return {
      problems: ["The page could not be checked just now. Save it again."],
      costUsd: 0,
    };
  }
}
