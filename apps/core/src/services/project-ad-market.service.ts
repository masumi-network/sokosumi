import { createHash } from "node:crypto";

import { z } from "@hono/zod-openapi";
import type { Prisma, ProjectAdMarketProfile } from "@sokosumi/database";

import { internalServerError, notFound } from "@/helpers/error";
import {
  fetchMarketAds,
  fetchMarketKeywords,
  type MarketAd,
  type MarketKeyword,
  type MarketKeywordQuery,
  marketAdSchema,
  marketKeywordSchema,
} from "@/lib/ads/dataforseo";
import {
  AD_MARKET_LOCATIONS,
  type AdMarketCountryCode,
  type AdMarketLanguageCode,
  countryCodeOfLocation,
  isAdMarketLanguage,
} from "@/lib/ads/markets";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  requireLockedOpenProject,
  requireScopedProject,
} from "@/services/project-social-connections.service";

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
  fetchedAt: Date;
}

export interface AdMarketAds {
  ads: MarketAd[];
  fetchedAt: Date;
}

function toProfile(profile: ProjectAdMarketProfile): AdMarketProfile {
  const countryCode = countryCodeOfLocation(profile.locationCode);
  if (!countryCode || !isAdMarketLanguage(profile.languageCode)) {
    throw internalServerError(
      "Market profile has an unsupported country or language",
    );
  }
  return {
    keywords: profile.keywords,
    countryCode,
    languageCode: profile.languageCode,
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
    await requireLockedOpenProject(tx, input, {
      closedMessage: "Cannot change a closing or closed Project",
    });
    return tx.projectAdMarketProfile.upsert({
      where: { projectId: input.projectId },
      create: { projectId: input.projectId, ...data },
      update: data,
    });
  }, "Market profile changed. Please retry.");
  return toProfile(profile);
}

/** The same profile, in any keyword order or case, maps to the same key. */
function profileRequestKey(profile: MarketKeywordQuery): string {
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
 * DataForSEO costs per call, so a snapshot of `kind` younger than 24h for the
 * same profile is served as is; otherwise `fetch` runs and its result replaces
 * the Project's snapshots of that kind.
 */
async function cachedMarketSnapshot<T extends Prisma.InputJsonValue>(
  input: ProjectScope & {
    kind: "keywords" | "ads";
    schema: z.ZodType<T[]>;
    fetch: (profile: ProjectAdMarketProfile) => Promise<T[]>;
  },
): Promise<{ data: T[]; fetchedAt: Date }> {
  await requireScopedProject(input);
  const profile = await prisma.projectAdMarketProfile.findUnique({
    where: { projectId: input.projectId },
  });
  if (!profile) throw notFound("Market profile not set");

  const { projectId, kind } = input;
  const requestKey = profileRequestKey(profile);
  const snapshotKey = {
    projectId_kind_requestKey: { projectId, kind, requestKey },
  };
  const cached = await prisma.projectAdMarketSnapshot.findUnique({
    where: snapshotKey,
  });
  if (cached && Date.now() - cached.fetchedAt.getTime() < SNAPSHOT_TTL_MS) {
    const parsed = input.schema.safeParse(cached.payload);
    if (parsed.success) {
      return { data: parsed.data, fetchedAt: cached.fetchedAt };
    }
  }

  const data = await input.fetch(profile);
  // fetchedAt only defaults on insert, so set it on update too.
  const fetchedAt = new Date();
  // The profile changed since any other snapshot was taken: drop those with it.
  await prisma.$transaction([
    prisma.projectAdMarketSnapshot.upsert({
      where: snapshotKey,
      create: { projectId, kind, requestKey, payload: data, fetchedAt },
      update: { payload: data, fetchedAt },
    }),
    prisma.projectAdMarketSnapshot.deleteMany({
      where: { projectId, kind, NOT: { requestKey } },
    }),
  ]);
  return { data, fetchedAt };
}

/** Trending keywords for the Project's market profile. */
export async function listProjectAdMarketKeywords(
  input: ProjectScope,
): Promise<AdMarketKeywords> {
  const { data, fetchedAt } = await cachedMarketSnapshot({
    ...input,
    kind: "keywords",
    schema: z.array(marketKeywordSchema),
    fetch: fetchMarketKeywords,
  });
  return { keywords: data, fetchedAt };
}

/** Recent ads of the advertisers in the Project's market profile. */
export async function listProjectAdMarketAds(
  input: ProjectScope,
): Promise<AdMarketAds> {
  const { data, fetchedAt } = await cachedMarketSnapshot({
    ...input,
    kind: "ads",
    schema: z.array(marketAdSchema),
    fetch: fetchMarketAds,
  });
  return { ads: data, fetchedAt };
}
