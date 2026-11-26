import { Prisma } from "@sokosumi/database";
import { cmoSearchAdSchema } from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";
import type { CmoSeoSuggestion } from "@/schemas/cmo-seo.schema";
import {
  CmoConflictError,
  CmoNotFoundError,
  type CusoTarget,
  requireCuso,
} from "@/services/cmo-cuso.service";
import { sameHost, toSuggestion } from "@/services/cmo-seo.service";
import { normalizeKeyword } from "@/services/cmo-seo-research.service";
import { approvedMarketingStrategy } from "@/services/marketing-strategy.service";

/**
 * The owner published a landing page: it is done at that address, and every
 * search ad on its search that is not launched yet sends people there. A
 * launched ad keeps its address; changing a running campaign stays a
 * deliberate step.
 */
export async function markCmoLandingPageLive(
  target: CusoTarget,
  id: string,
  url: string,
  now: Date = new Date(),
): Promise<{
  page: CmoSeoSuggestion;
  adsUpdated: number;
  adsLaunched: number;
}> {
  const cuso = await requireCuso(target);
  const row = await prisma.projectSeoSuggestion.findFirst({
    where: { id, projectId: cuso.projectId, kind: "landing_page" },
  });
  if (!row) throw new CmoNotFoundError("Landing page not found");
  if (!sameHost(url, cuso.websiteUrl))
    throw new CmoConflictError(
      `That address is not on ${new URL(cuso.websiteUrl).hostname}. Paste the page's address on your own site.`,
    );
  const search = normalizeKeyword(row.keyword ?? "");
  const approved = await approvedMarketingStrategy(cuso.projectId);
  const ads = approved
    ? (
        await prisma.marketingStrategyFile.findMany({
          where: {
            marketingStrategyId: approved.id,
            searchAd: { not: Prisma.DbNull },
          },
          select: { id: true, searchAd: true, adCampaignId: true },
        })
      ).flatMap((file) => {
        const ad = cmoSearchAdSchema.safeParse(file.searchAd);
        return ad.success &&
          ad.data.keywords.some(
            (keyword) => normalizeKeyword(keyword) === search,
          )
          ? [{ ...file, ad: ad.data }]
          : [];
      })
    : [];
  const waiting = ads.filter((file) => !file.adCampaignId);
  const [page] = await prisma.$transaction([
    prisma.projectSeoSuggestion.update({
      where: { id },
      data: { pageUrl: url, status: "done", doneAt: now },
    }),
    ...waiting.map((file) =>
      prisma.marketingStrategyFile.update({
        where: { id: file.id },
        data: { searchAd: { ...file.ad, finalUrl: url } },
      }),
    ),
  ]);
  return {
    page: toSuggestion(page),
    adsUpdated: waiting.length,
    adsLaunched: ads.length - waiting.length,
  };
}
