import { createHash } from "node:crypto";

import { z } from "@hono/zod-openapi";
import type { ProjectAdMarketProfile } from "@sokosumi/database";

import { internalServerError, notFound } from "@/helpers/error";
import {
  fetchMarketKeywords,
  type MarketKeyword,
  marketKeywordSchema,
} from "@/lib/ads/dataforseo";
import {
  AD_MARKET_LOCATIONS,
  type AdMarketCountryCode,
  type AdMarketLanguageCode,
  countryCodeOfLocation,
} from "@/lib/ads/markets";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  requireLockedOpenProject,
  requireScopedProject,
} from "@/services/project-social-connections.service";

const KEYWORDS_SNAPSHOT = "keywords";
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

interface ProjectScope {
  projectId: string;
  workspaceId: string;
}

export interface AdMarketProfile {
  keywords: string[];
  countryCode: AdMarketCountryCode;
  languageCode: AdMarketLanguageCode;
  updatedAt: Date;
}

export interface AdMarketKeywords {
  keywords: MarketKeyword[];
  currency: "USD";
  fetchedAt: Date;
}

function toProfile(profile: ProjectAdMarketProfile): AdMarketProfile {
  const countryCode = countryCodeOfLocation(profile.locationCode);
  if (!countryCode) {
    throw internalServerError("Market profile has an unsupported country");
  }
  return {
    keywords: profile.keywords,
    countryCode,
    // Only supported languages are written.
    languageCode: profile.languageCode as AdMarketLanguageCode,
    updatedAt: profile.updatedAt,
  };
}

export async function getProjectAdMarketProfile(
  input: ProjectScope,
): Promise<AdMarketProfile | null> {
  await requireScopedProject(input);
  const profile = await prisma.projectAdMarketProfile.findUnique({
    where: { projectId: input.projectId },
  });
  return profile ? toProfile(profile) : null;
}

/** Keeps the first spelling of each keyword, comparing case-insensitively. */
function dedupeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  return keywords.filter((keyword) => {
    const key = keyword.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function setProjectAdMarketProfile(
  input: ProjectScope & {
    keywords: string[];
    countryCode: AdMarketCountryCode;
    languageCode: AdMarketLanguageCode;
  },
): Promise<AdMarketProfile> {
  const data = {
    keywords: dedupeKeywords(input.keywords),
    locationCode: AD_MARKET_LOCATIONS[input.countryCode],
    languageCode: input.languageCode,
  };
  const profile = await serializableTransaction(async (tx) => {
    await requireLockedOpenProject(tx, input);
    return tx.projectAdMarketProfile.upsert({
      where: { projectId: input.projectId },
      create: { projectId: input.projectId, ...data },
      update: data,
    });
  }, "Market profile changed. Please retry.");
  return toProfile(profile);
}

/** The same profile, in any keyword order or case, maps to the same key. */
function keywordsRequestKey(profile: ProjectAdMarketProfile): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        keywords: profile.keywords.map((k) => k.toLowerCase()).sort(),
        locationCode: profile.locationCode,
        languageCode: profile.languageCode,
      }),
    )
    .digest("hex");
}

/**
 * Trending keywords for the Project's market profile. DataForSEO costs per
 * call, so a snapshot younger than 24h for the same profile is served as is.
 */
export async function listProjectAdMarketKeywords(
  input: ProjectScope,
): Promise<AdMarketKeywords> {
  await requireScopedProject(input);
  const profile = await prisma.projectAdMarketProfile.findUnique({
    where: { projectId: input.projectId },
  });
  if (!profile) throw notFound("Market profile not set");

  const requestKey = keywordsRequestKey(profile);
  const cached = await prisma.projectAdMarketSnapshot.findUnique({
    where: {
      projectId_kind_requestKey: {
        projectId: input.projectId,
        kind: KEYWORDS_SNAPSHOT,
        requestKey,
      },
    },
  });
  if (cached && Date.now() - cached.fetchedAt.getTime() < SNAPSHOT_TTL_MS) {
    const parsed = z.array(marketKeywordSchema).safeParse(cached.payload);
    if (parsed.success) {
      return {
        keywords: parsed.data,
        currency: "USD",
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  const keywords = await fetchMarketKeywords({
    keywords: profile.keywords,
    locationCode: profile.locationCode,
    languageCode: profile.languageCode,
  });
  // fetchedAt only defaults on insert, so set it on update too.
  const fetchedAt = new Date();
  await prisma.projectAdMarketSnapshot.upsert({
    where: {
      projectId_kind_requestKey: {
        projectId: input.projectId,
        kind: KEYWORDS_SNAPSHOT,
        requestKey,
      },
    },
    create: {
      projectId: input.projectId,
      kind: KEYWORDS_SNAPSHOT,
      requestKey,
      payload: keywords,
      fetchedAt,
    },
    update: { payload: keywords, fetchedAt },
  });
  return { keywords, currency: "USD", fetchedAt };
}
