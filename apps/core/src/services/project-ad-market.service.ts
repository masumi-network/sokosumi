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
  type SerpTaskKind,
} from "@/lib/ads/dataforseo";
import {
  AD_MARKET_LOCATIONS,
  type AdMarketAdsStatus,
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
/** A check holds the job this long: more than any check takes. */
const LEASE_MS = 90_000;
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
  status: AdMarketAdsStatus;
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

function isFresh(fetchedAt: Date): boolean {
  return Date.now() - fetchedAt.getTime() < SNAPSHOT_TTL_MS;
}

/**
 * Writes the Project's snapshot of `kind` and drops the others of that kind:
 * the profile changed since they were taken.
 */
async function writeSnapshot(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    kind: SnapshotKind;
    requestKey: string;
    data: Prisma.InputJsonValue;
    fetchedAt: Date;
  },
) {
  const { projectId, kind, requestKey, data, fetchedAt } = input;
  await tx.projectAdMarketSnapshot.upsert({
    where: { projectId_kind_requestKey: { projectId, kind, requestKey } },
    create: { projectId, kind, requestKey, payload: data, fetchedAt },
    // fetchedAt only defaults on insert, so set it on update too.
    update: { payload: data, fetchedAt },
  });
  await tx.projectAdMarketSnapshot.deleteMany({
    where: { projectId, kind, NOT: { requestKey } },
  });
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
 * Trending keywords for the Project's market profile. DataForSEO costs per
 * call, so a snapshot younger than 24h for the same profile is served as is;
 * otherwise the fetched keywords replace the Project's snapshots.
 */
export async function listProjectAdMarketKeywords(
  input: ProjectScope,
): Promise<AdMarketKeywords> {
  const profile = await requireProfile(input);
  const { projectId } = input;
  const requestKey = profileRequestKey(profile);
  const cached = await readSnapshot({
    projectId,
    kind: "keywords",
    requestKey,
    schema: z.array(marketKeywordSchema),
  });
  if (cached && isFresh(cached.fetchedAt)) {
    return { keywords: cached.data, fetchedAt: cached.fetchedAt };
  }

  const keywords = await fetchMarketKeywords(profile);
  const fetchedAt = new Date();
  await prisma.$transaction((tx) =>
    writeSnapshot(tx, {
      projectId,
      kind: "keywords",
      requestKey,
      data: keywords,
      fetchedAt,
    }),
  );
  return { keywords, fetchedAt };
}

const organicRanksListSchema = z.array(z.array(organicRankSchema));
const adsListSchema = z.array(z.array(marketAdSchema));

type Waiting = Exclude<AdMarketAdsStatus, "ready">;
interface FinishedAds {
  ads: MarketAd[];
  fetchedAt: Date;
}
type JobProgress = Waiting | FinishedAds;

/**
 * The right to write the Project's job: its row holds this `nextCheckAt`. A
 * request takes it by moving `nextCheckAt` a lease ahead, so no other check
 * starts meanwhile. Every write after is conditional on it, so a request that
 * outlived its lease, or whose job a profile change replaced, writes nothing.
 */
interface Lease {
  projectId: string;
  requestKey: string;
  nextCheckAt: Date;
}

function newLease(projectId: string, requestKey: string, now: Date): Lease {
  return {
    projectId,
    requestKey,
    nextCheckAt: new Date(now.getTime() + LEASE_MS),
  };
}

/** Ends a check: the job may be checked again after the interval. */
function released() {
  return { nextCheckAt: new Date(Date.now() + CHECK_INTERVAL_MS) };
}

/** Writes the job if the lease is still ours. */
async function writeLeased(
  lease: Lease,
  data: Prisma.ProjectAdMarketAdsJobUpdateManyMutationInput,
): Promise<boolean> {
  const { count } = await prisma.projectAdMarketAdsJob.updateMany({
    where: lease,
    data,
  });
  return count > 0;
}

/**
 * Moves the Project's market ads job a step: starts it, or checks its queued
 * DataForSEO tasks. Only a request that wins the claim (an insert or an update
 * on the `nextCheckAt` it saw) acts; the others wait for the next poll.
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
    return startAdsJob(profile, requestKey, job?.nextCheckAt ?? null, now);
  }
  if (job.stage === ProjectAdMarketAdsJobStage.FAILED) {
    return now.getTime() - job.startedAt.getTime() < FAILED_RETRY_MS
      ? "failed"
      : startAdsJob(profile, requestKey, job.nextCheckAt, now);
  }
  if (job.nextCheckAt > now) return "gathering";
  const lease = newLease(projectId, requestKey, now);
  const claim = await prisma.projectAdMarketAdsJob.updateMany({
    where: { projectId, requestKey, nextCheckAt: job.nextCheckAt },
    data: { nextCheckAt: lease.nextCheckAt },
  });
  return claim.count === 0
    ? "gathering"
    : checkAdsJob(profile, job, lease, now);
}

/**
 * Queues the SERP tasks of a new job. It replaces the job that holds
 * `previousNextCheckAt` (one for another profile, a failed one, one to
 * restart), if any.
 */
async function startAdsJob(
  profile: ProjectAdMarketProfile,
  requestKey: string,
  previousNextCheckAt: Date | null,
  now: Date,
): Promise<JobProgress> {
  const { projectId } = profile;
  const lease = newLease(projectId, requestKey, now);
  const fresh = {
    stage: ProjectAdMarketAdsJobStage.SERP,
    pendingTaskIds: [],
    collected: [],
    startedAt: now,
    requestKey,
    nextCheckAt: lease.nextCheckAt,
  };
  // Claim before posting, so two requests never both pay for the same tasks.
  const claim = previousNextCheckAt
    ? await prisma.projectAdMarketAdsJob.updateMany({
        where: { projectId, nextCheckAt: previousNextCheckAt },
        data: fresh,
      })
    : await prisma.projectAdMarketAdsJob.createMany({
        data: { projectId, ...fresh },
        skipDuplicates: true,
      });
  if (claim.count === 0) return "gathering";
  // If nothing was queued, release the claim so the next poll starts again.
  const pendingTaskIds = await postSerpTasks(profile).catch(
    async (error: unknown) => {
      await prisma.projectAdMarketAdsJob.deleteMany({ where: lease });
      throw error;
    },
  );
  if (pendingTaskIds.length === 0) return failJob(lease);
  await writeLeased(lease, { pendingTaskIds, ...released() });
  return "gathering";
}

/**
 * Reads the pending tasks of the job's stage. Returns what the stage gathered
 * once none is pending, or where the check ends: still gathering, or failed
 * because no task gave a result.
 */
async function gatherStage<T extends Prisma.InputJsonValue>(input: {
  profile: ProjectAdMarketProfile;
  job: ProjectAdMarketAdsJob;
  lease: Lease;
  now: Date;
  kind: SerpTaskKind;
  schema: z.ZodType<T[]>;
  toCollected: (items: unknown[]) => T;
}): Promise<{ collected: T[] } | { progress: JobProgress }> {
  const { profile, job, lease, now } = input;
  const stored = input.schema.safeParse(job.collected);
  if (!stored.success) {
    return {
      progress: await startAdsJob(
        profile,
        lease.requestKey,
        lease.nextCheckAt,
        now,
      ),
    };
  }
  const results = await Promise.all(
    job.pendingTaskIds.map(async (id) => ({
      id,
      result: await getTaskResult(input.kind, id),
    })),
  );
  const collected = [
    ...stored.data,
    ...results.flatMap(({ result }) =>
      result.state === "done" ? [input.toCollected(result.items)] : [],
    ),
  ];
  const expired = now.getTime() - job.startedAt.getTime() > STAGE_TIMEOUT_MS;
  const pendingTaskIds = expired
    ? []
    : results.flatMap(({ id, result }) =>
        result.state === "pending" ? [id] : [],
      );
  if (pendingTaskIds.length > 0) {
    await writeLeased(lease, { pendingTaskIds, collected, ...released() });
    return { progress: "gathering" };
  }
  return collected.length === 0
    ? { progress: await failJob(lease) }
    : { collected };
}

async function checkAdsJob(
  profile: ProjectAdMarketProfile,
  job: ProjectAdMarketAdsJob,
  lease: Lease,
  now: Date,
): Promise<JobProgress> {
  const common = { profile, job, lease, now };
  if (job.stage === ProjectAdMarketAdsJobStage.SERP) {
    const serps = await gatherStage({
      ...common,
      kind: "organic",
      schema: organicRanksListSchema,
      toCollected: organicRanks,
    });
    if ("progress" in serps) return serps.progress;
    const competitors = rankCompetitorDomains(serps.collected);
    if (competitors.length === 0) return finishAdsJob(lease, []);
    // A transport error leaves the lease held: the stage is retried after it.
    const pendingTaskIds = await postAdsSearchTasks(
      competitors,
      profile.locationCode,
      now,
    );
    // Refused: retrying each poll would not help.
    if (pendingTaskIds.length === 0) return failJob(lease);
    await writeLeased(lease, {
      stage: ProjectAdMarketAdsJobStage.ADS,
      pendingTaskIds,
      collected: [],
      startedAt: now,
      ...released(),
    });
    return "gathering";
  }
  const ads = await gatherStage({
    ...common,
    kind: "ads_search",
    schema: adsListSchema,
    toCollected: competitorAds,
  });
  return "progress" in ads
    ? ads.progress
    : finishAdsJob(lease, mergeMarketAds(ads.collected));
}

/** Every task of the stage failed. The job stays, so polling does not repost. */
async function failJob(lease: Lease): Promise<Waiting> {
  const written = await writeLeased(lease, {
    stage: ProjectAdMarketAdsJobStage.FAILED,
    pendingTaskIds: [],
    collected: [],
    startedAt: new Date(),
    ...released(),
  });
  return written ? "failed" : "gathering";
}

/** Deletes the job and writes its ads as the snapshot, if the lease is still ours. */
async function finishAdsJob(
  lease: Lease,
  ads: MarketAd[],
): Promise<JobProgress> {
  const { projectId, requestKey } = lease;
  const fetchedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.projectAdMarketAdsJob.deleteMany({
      where: lease,
    });
    if (count === 0) return "gathering";
    await writeSnapshot(tx, {
      projectId,
      kind: "ads",
      requestKey,
      data: ads,
      fetchedAt,
    });
    return { ads, fetchedAt };
  });
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
