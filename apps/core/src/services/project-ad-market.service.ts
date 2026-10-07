import { createHash } from "node:crypto";

import { z } from "@hono/zod-openapi";
import {
  type Prisma,
  type ProjectAdMarketAdsJob,
  ProjectAdMarketAdsJobStage,
  type ProjectAdMarketProfile,
} from "@sokosumi/database";

import { internalServerError, notFound } from "@/helpers/error";
import {
  competitorAds,
  fetchMarketKeywords,
  getTaskResult,
  type MarketAd,
  type MarketKeyword,
  type MarketQuery,
  marketAdSchema,
  marketKeywordSchema,
  mergeMarketAds,
  organicRankSchema,
  organicRanks,
  postAdsSearchTasks,
  postSerpTasks,
  rankCompetitorDomains,
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
/** Polling clients may ask every few seconds; DataForSEO is checked this often. */
const CHECK_INTERVAL_MS = 20_000;
/** Queued tasks are ready in minutes; one still pending after this is dropped. */
const STAGE_TIMEOUT_MS = 30 * 60 * 1000;
/** A failed job is not retried sooner, which caps what a broken lookup costs. */
const FAILED_RETRY_MS = 60 * 60 * 1000;

type SnapshotKind = "keywords" | "ads";

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
  /** `gathering` and `failed` carry the previous snapshot's ads, if any. */
  status: "ready" | "gathering" | "failed";
  ads: MarketAd[];
  /** When the ads were taken; null while there is no snapshot yet. */
  fetchedAt: Date | null;
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
function profileRequestKey(profile: MarketQuery): string {
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

/** The Project's snapshot of `kind` for the profile key, whatever its age. */
async function readSnapshot<T>(input: {
  projectId: string;
  kind: SnapshotKind;
  requestKey: string;
  schema: z.ZodType<T[]>;
}): Promise<{ data: T[]; fetchedAt: Date } | null> {
  const { projectId, kind, requestKey } = input;
  const cached = await prisma.projectAdMarketSnapshot.findUnique({
    where: { projectId_kind_requestKey: { projectId, kind, requestKey } },
  });
  const parsed = cached && input.schema.safeParse(cached.payload);
  return cached && parsed?.success
    ? { data: parsed.data, fetchedAt: cached.fetchedAt }
    : null;
}

const isFresh = (fetchedAt: Date) =>
  Date.now() - fetchedAt.getTime() < SNAPSHOT_TTL_MS;

/**
 * Writes the Project's snapshot of `kind` and drops the others of that kind:
 * the profile changed since they were taken.
 */
function snapshotWrites(input: {
  projectId: string;
  kind: SnapshotKind;
  requestKey: string;
  data: Prisma.InputJsonValue;
  fetchedAt: Date;
}) {
  const { projectId, kind, requestKey, data, fetchedAt } = input;
  return [
    prisma.projectAdMarketSnapshot.upsert({
      where: { projectId_kind_requestKey: { projectId, kind, requestKey } },
      create: { projectId, kind, requestKey, payload: data, fetchedAt },
      // fetchedAt only defaults on insert, so set it on update too.
      update: { payload: data, fetchedAt },
    }),
    prisma.projectAdMarketSnapshot.deleteMany({
      where: { projectId, kind, NOT: { requestKey } },
    }),
  ];
}

async function requireProfile(input: ProjectScope) {
  await requireScopedProject(input);
  const profile = await prisma.projectAdMarketProfile.findUnique({
    where: { projectId: input.projectId },
  });
  if (!profile) throw notFound("Market profile not set");
  return profile;
}

/**
 * DataForSEO costs per call, so a snapshot of `kind` younger than 24h for the
 * same profile is served as is; otherwise `fetch` runs and its result replaces
 * the Project's snapshots of that kind.
 */
async function cachedMarketSnapshot<T extends Prisma.InputJsonValue>(
  input: ProjectScope & {
    kind: SnapshotKind;
    schema: z.ZodType<T[]>;
    fetch: (profile: ProjectAdMarketProfile) => Promise<T[]>;
  },
): Promise<{ data: T[]; fetchedAt: Date }> {
  const profile = await requireProfile(input);
  const { projectId, kind } = input;
  const requestKey = profileRequestKey(profile);
  const cached = await readSnapshot({
    projectId,
    kind,
    requestKey,
    schema: input.schema,
  });
  if (cached && isFresh(cached.fetchedAt)) return cached;

  const data = await input.fetch(profile);
  const fetchedAt = new Date();
  await prisma.$transaction(
    snapshotWrites({ projectId, kind, requestKey, data, fetchedAt }),
  );
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

const organicRanksListSchema = z.array(z.array(organicRankSchema));
const adsListSchema = z.array(z.array(marketAdSchema));

type JobProgress = AdMarketAds["status"] | { ads: MarketAd[]; fetchedAt: Date };

/**
 * Moves the Project's market ads job a step: starts it, or checks its queued
 * DataForSEO tasks. Exactly one concurrent request acts on a given job state
 * (the claim is an update or insert that only one can win); the others wait
 * for the next poll.
 */
async function advanceAdsJob(
  profile: ProjectAdMarketProfile,
  requestKey: string,
): Promise<JobProgress> {
  const { projectId } = profile;
  const now = new Date();
  const job = await prisma.projectAdMarketAdsJob.findUnique({
    where: { projectId },
  });
  if (!job || job.requestKey !== requestKey) {
    return startAdsJob(profile, requestKey, job?.checkedAt ?? null, now);
  }
  if (job.stage === ProjectAdMarketAdsJobStage.FAILED) {
    return now.getTime() - job.startedAt.getTime() < FAILED_RETRY_MS
      ? "failed"
      : startAdsJob(profile, requestKey, job.checkedAt, now);
  }
  if (now.getTime() - job.checkedAt.getTime() < CHECK_INTERVAL_MS) {
    return "gathering";
  }
  const claim = await prisma.projectAdMarketAdsJob.updateMany({
    where: { projectId, checkedAt: job.checkedAt },
    data: { checkedAt: now },
  });
  return claim.count === 0 ? "gathering" : checkAdsJob(profile, job, now);
}

/**
 * Queues the SERP tasks of a new job. It replaces the job last checked at
 * `previousCheckedAt` (one for another profile, a failed one), if any.
 */
async function startAdsJob(
  profile: ProjectAdMarketProfile,
  requestKey: string,
  previousCheckedAt: Date | null,
  now: Date,
): Promise<JobProgress> {
  const { projectId } = profile;
  const claimed = {
    requestKey,
    stage: ProjectAdMarketAdsJobStage.SERP,
    pendingTaskIds: [],
    collected: [],
    startedAt: now,
    checkedAt: now,
  };
  // Claim before posting, so two requests never both pay for the same tasks.
  const claim = previousCheckedAt
    ? await prisma.projectAdMarketAdsJob.updateMany({
        where: { projectId, checkedAt: previousCheckedAt },
        data: claimed,
      })
    : await prisma.projectAdMarketAdsJob.createMany({
        data: { projectId, ...claimed },
        skipDuplicates: true,
      });
  if (claim.count === 0) return "gathering";
  // If nothing was queued, release the claim so the next poll starts again.
  const pendingTaskIds = await postSerpTasks(profile).catch(
    async (error: unknown) => {
      await prisma.projectAdMarketAdsJob.deleteMany({
        where: { projectId, requestKey },
      });
      throw error;
    },
  );
  await prisma.projectAdMarketAdsJob.update({
    where: { projectId },
    data: { pendingTaskIds },
  });
  return "gathering";
}

/** Reads the job's pending tasks, keeping the ones still queued. */
async function collectTasks<T>(
  job: ProjectAdMarketAdsJob,
  kind: "organic" | "ads_search",
  collected: T[],
  toCollected: (items: unknown[]) => T,
  now: Date,
): Promise<{ pending: string[]; collected: T[] }> {
  const results = await Promise.all(
    job.pendingTaskIds.map(async (id) => ({
      id,
      result: await getTaskResult(kind, id),
    })),
  );
  const pending = results.flatMap(({ id, result }) =>
    result.state === "pending" ? [id] : [],
  );
  const gathered = [
    ...collected,
    ...results.flatMap(({ result }) =>
      result.state === "done" ? [toCollected(result.items)] : [],
    ),
  ];
  const expired = now.getTime() - job.startedAt.getTime() > STAGE_TIMEOUT_MS;
  return { pending: expired ? [] : pending, collected: gathered };
}

async function checkAdsJob(
  profile: ProjectAdMarketProfile,
  job: ProjectAdMarketAdsJob,
  now: Date,
): Promise<JobProgress> {
  const { projectId, requestKey } = job;
  const where = { projectId };
  const store = (data: Prisma.ProjectAdMarketAdsJobUpdateInput) =>
    prisma.projectAdMarketAdsJob.update({ where, data });

  if (job.stage === ProjectAdMarketAdsJobStage.SERP) {
    const stored = organicRanksListSchema.safeParse(job.collected);
    if (!stored.success) return startAdsJob(profile, requestKey, now, now);
    const { pending, collected } = await collectTasks(
      job,
      "organic",
      stored.data,
      organicRanks,
      now,
    );
    if (pending.length > 0) {
      await store({ pendingTaskIds: pending, collected });
      return "gathering";
    }
    if (collected.length === 0) return failJob(projectId, now);
    const competitors = rankCompetitorDomains(collected);
    if (competitors.length === 0) {
      return finishAdsJob(projectId, requestKey, []);
    }
    const pendingTaskIds = await postAdsSearchTasks(
      competitors,
      profile.locationCode,
      now,
    );
    await store({
      stage: ProjectAdMarketAdsJobStage.ADS,
      pendingTaskIds,
      collected: [],
      startedAt: now,
    });
    return "gathering";
  }

  const stored = adsListSchema.safeParse(job.collected);
  if (!stored.success) return startAdsJob(profile, requestKey, now, now);
  const { pending, collected } = await collectTasks(
    job,
    "ads_search",
    stored.data,
    competitorAds,
    now,
  );
  if (pending.length > 0) {
    await store({ pendingTaskIds: pending, collected });
    return "gathering";
  }
  if (collected.length === 0) return failJob(projectId, now);
  return finishAdsJob(projectId, requestKey, mergeMarketAds(collected));
}

/** Every task of the stage failed. The job stays, so polling does not repost. */
async function failJob(projectId: string, now: Date): Promise<"failed"> {
  await prisma.projectAdMarketAdsJob.update({
    where: { projectId },
    data: {
      stage: ProjectAdMarketAdsJobStage.FAILED,
      pendingTaskIds: [],
      collected: [],
      startedAt: now,
    },
  });
  return "failed";
}

async function finishAdsJob(
  projectId: string,
  requestKey: string,
  ads: MarketAd[],
): Promise<JobProgress> {
  const fetchedAt = new Date();
  await prisma.$transaction([
    ...snapshotWrites({
      projectId,
      kind: "ads",
      requestKey,
      data: ads,
      fetchedAt,
    }),
    prisma.projectAdMarketAdsJob.deleteMany({ where: { projectId } }),
  ]);
  return { ads, fetchedAt };
}

/**
 * Recent ads of the search competitors for the Project's market profile. Queued
 * DataForSEO tasks take minutes, so the ads are built by a job that each call
 * moves forward: `gathering` until it finishes, polled by the client. While
 * gathering or failed, the ads are the previous snapshot's, if any.
 */
export async function listProjectAdMarketAds(
  input: ProjectScope,
): Promise<AdMarketAds> {
  const profile = await requireProfile(input);
  const requestKey = profileRequestKey(profile);
  const snapshot = await readSnapshot({
    projectId: input.projectId,
    kind: "ads",
    requestKey,
    schema: z.array(marketAdSchema),
  });
  if (snapshot && isFresh(snapshot.fetchedAt)) {
    return {
      status: "ready",
      ads: snapshot.data,
      fetchedAt: snapshot.fetchedAt,
    };
  }
  const progress = await advanceAdsJob(profile, requestKey);
  if (typeof progress !== "string") return { status: "ready", ...progress };
  return {
    status: progress,
    ads: snapshot?.data ?? [],
    fetchedAt: snapshot?.fetchedAt ?? null,
  };
}
