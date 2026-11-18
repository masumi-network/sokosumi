import type { CompetitorPageKind, Prisma } from "@sokosumi/database";
import { z } from "zod";

import {
  type MetaAd,
  metaAdLibraryConfigured,
  metaAdLibraryPageUrl,
  searchMetaAds,
} from "@/clients/meta-ad-library.client";
import { getEnv } from "@/config/env";
import { notifyCusoLowCreditsAfterCharge } from "@/helpers/cuso-low-credit-notification";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import {
  type InstagramReader,
  type InstagramWeek,
  readCompetitorInstagram,
} from "@/lib/competitors/instagram";
import { competitorNews, NEWS_JUNK_DOMAINS } from "@/lib/competitors/news";
import { type PickedNews, pickNews } from "@/lib/competitors/news-pick";
import { type PageChange, readPageChange } from "@/lib/competitors/page-change";
import {
  diffLines,
  type PageDiff,
  type PriceMove,
  priceMove,
} from "@/lib/competitors/page-diff";
import {
  pricingLink,
  profileHandle,
  readCompetitorPage,
} from "@/lib/competitors/page-read";
import { bareHost } from "@/lib/competitors/text";
import prisma from "@/lib/db/prisma";
import { isEvalCusoProject } from "@/lib/evals/eval-guard";
import { createCoreLogger, recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { searchExa } from "@/lib/soko-bot/exa";
import { isCmoSubscribed } from "@/services/cmo-billing.service";
import {
  listTrackedCompetitors,
  syncTrackedCompetitorsFromBrandBrain,
  type TrackedCompetitorRow,
} from "@/services/cmo-competitors.service";
import {
  type Cuso,
  listCusosWithApprovedStrategy,
} from "@/services/cmo-cuso.service";
import { chargeSokoBotCredits } from "@/services/soko-bot-billing.service";

/**
 * The price of one competitor in one weekly check, in credits: its two
 * pages read and compared, a news search, its new ads and its Instagram
 * week. Five competitors cost 15 credits a week.
 */
export const COMPETITOR_CHECK_CREDITS = 3;
/**
 * How long after a check the next one is due: a week, less half a day, so
 * the hourly cron's slot moving never pushes a check to day eight.
 */
export const CHECK_EVERY_MS = 6.5 * 86_400_000;
/** A check that has not finished after this long died; the next run redoes it. */
const STALE_CHECK_MS = 3_600_000;
const WEEK_MS = 7 * 86_400_000;
const NEWS_RESULTS = 10;
/** How long after a check its watch run may still start. */
const WATCH_RUN_WINDOW_MS = 2 * 86_400_000;
/** Lines of a page's change kept on its signal. */
const KEPT_DIFF_LINES = 40;
const MAX_ADS_KEPT = 20;

export const COMPETITOR_SOURCES = ["pages", "news", "ads", "social"] as const;
export type CompetitorSource = (typeof COMPETITOR_SOURCES)[number];

/**
 * not_configured: Core lacks access to the source. not_connected: the owner
 * has not connected the account it is read through. failed: it could not be
 * read.
 */
export const COMPETITOR_SOURCE_STATUSES = [
  "ok",
  "not_configured",
  "not_connected",
  "failed",
] as const;

const sourceStateSchema = z.object({
  status: z.enum(COMPETITOR_SOURCE_STATUSES),
});
/** `competitor_check.sources`: how each source answered in one check. */
export const competitorCheckSourcesSchema = z.object({
  pages: sourceStateSchema,
  news: sourceStateSchema,
  ads: sourceStateSchema,
  social: sourceStateSchema,
});
export type CompetitorCheckSources = z.infer<
  typeof competitorCheckSourcesSchema
>;
export type CompetitorSourceStatus =
  (typeof COMPETITOR_SOURCE_STATUSES)[number];
type SourceStatus = CompetitorSourceStatus;

export type SignalDraft = Omit<
  Prisma.CompetitorSignalCreateManyInput,
  "id" | "createdAt" | "competitorId" | "projectId"
>;

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function pageChangeSignal(
  change: PageChange,
  page: { kind: CompetitorPageKind; url: string; competitor: string },
  found: { diff: PageDiff; prices: PriceMove | null },
  now: Date,
): SignalDraft {
  // A price change is a moved price, or the model reading plans or limits;
  // other copy on a pricing page is a website change.
  const pricing = found.prices !== null || change.about === "pricing";
  return {
    kind: pricing ? "PRICE_CHANGE" : "WEBSITE_CHANGE",
    summary: change.summary,
    observedAt: now,
    sourceUrl: page.url,
    sourceTitle:
      page.kind === "PRICING"
        ? `${page.competitor} pricing`
        : `${page.competitor} homepage`,
    sourcePublisher: page.competitor,
    quote: change.quote || null,
    raw: {
      page: page.kind,
      about: change.about,
      added: found.diff.added.slice(0, KEPT_DIFF_LINES),
      removed: found.diff.removed.slice(0, KEPT_DIFF_LINES),
      ...(found.prices ? { prices: found.prices } : {}),
    },
    // Each reading replaces the last, so a change is only ever seen once.
    dedupeKey: `page:${page.kind}:${day(now)}`,
  };
}

export function newsSignals(items: readonly PickedNews[]): SignalDraft[] {
  return items.map((item) => ({
    kind: "NEWS",
    summary: item.summary,
    observedAt: item.publishedAt,
    sourceUrl: item.url,
    sourceTitle: item.title,
    sourcePublisher: item.publisher,
    quote: item.quote,
    raw: {
      title: item.title,
      url: item.url,
      publisher: item.publisher,
      publishedAt: item.publishedAt.toISOString(),
    },
    dedupeKey: `news:${item.url}`,
  }));
}

/** One signal for the ads a competitor started since the last check. */
export function adsSignal(
  ads: readonly MetaAd[],
  competitor: string,
  now: Date,
): SignalDraft | null {
  const [first] = ads;
  if (!first) return null;
  return {
    kind: "AD",
    summary: `${ads.length} new ${ads.length === 1 ? "ad" : "ads"} running in the EU`,
    observedAt: now,
    sourceUrl: metaAdLibraryPageUrl(first.pageId),
    sourceTitle: `${competitor} in the Meta Ad Library`,
    sourcePublisher: "Meta Ad Library",
    quote: ads.find((ad) => ad.body)?.body ?? null,
    raw: { count: ads.length, ads: ads.slice(0, MAX_ADS_KEPT) },
    dedupeKey: `ads:${day(now)}`,
  };
}

/** One signal a week for a competitor's Instagram account. */
export function socialSignal(week: InstagramWeek, now: Date): SignalDraft {
  const followers =
    week.followers === null
      ? ""
      : `, ${week.followers.toLocaleString("en-US")} followers`;
  return {
    kind: "SOCIAL",
    summary: `${week.postsThisWeek} Instagram ${week.postsThisWeek === 1 ? "post" : "posts"} this week${followers}`,
    observedAt: now,
    sourceUrl: `https://www.instagram.com/${week.handle}/`,
    sourceTitle: `@${week.handle} on Instagram`,
    sourcePublisher: "Instagram",
    // Counts, not words: nothing on the profile says them in one line.
    quote: null,
    raw: { network: "instagram", ...week },
    dedupeKey: `instagram:${day(now)}`,
  };
}

interface SourceResult {
  drafts: SignalDraft[];
  costUsd: number;
  status: SourceStatus;
}

function skipped(status: SourceStatus): SourceResult {
  return { drafts: [], costUsd: 0, status };
}

function failed(
  source: CompetitorSource,
  competitor: TrackedCompetitorRow,
  error: unknown,
): SourceResult {
  // A page, an article or an ad can carry anything its author wrote.
  recordCoreWarning(
    { operation: "cmo_competitor_check", competitor: { id: competitor.id } },
    {
      message: "A competitor check source failed",
      why: "Reading this source for one competitor threw",
      fix: "The other sources and competitors were still checked, and next week's check reads it again. If it repeats, look up the error name and code under failure.",
      details: { source, failure: messageSafeErrorFields(error) },
    },
  );
  return skipped("failed");
}

/**
 * Compares one page with last week's reading and replaces that reading.
 * The first reading, and the first after its address changed, is only kept.
 * When the summary model fails on a change without a price move the old
 * reading stays, so next week's check still sees the change.
 */
async function checkPage(
  competitor: TrackedCompetitorRow,
  kind: CompetitorPageKind,
  url: string,
  lines: string[],
  now: Date,
): Promise<{ drafts: SignalDraft[]; costUsd: number }> {
  const where = { competitorId_kind: { competitorId: competitor.id, kind } };
  const before = await prisma.competitorPageSnapshot.findUnique({
    where,
    select: { url: true, text: true },
  });
  const reading = { url, text: lines.join("\n"), fetchedAt: now };
  const keep = () =>
    prisma.competitorPageSnapshot.upsert({
      where,
      create: { competitorId: competitor.id, kind, ...reading },
      update: reading,
    });
  if (!before || before.url !== url) {
    await keep();
    return { drafts: [], costUsd: 0 };
  }
  const old = before.text.split("\n");
  const diff = diffLines(old, lines);
  // Only a pricing page's prices count: a homepage rotates offers and deals.
  const prices = kind === "PRICING" ? priceMove(old, lines) : null;
  const { change, costUsd } = await readPageChange({
    competitor: competitor.name,
    page: kind === "PRICING" ? "pricing page" : "homepage",
    diff,
    lines,
    prices,
  });
  await keep();
  return {
    drafts: change
      ? [
          pageChangeSignal(
            change,
            { kind, url, competitor: competitor.name },
            { diff, prices },
            now,
          ),
        ]
      : [],
    costUsd,
  };
}

/**
 * A competitor's homepage and pricing page. The homepage also names what
 * nobody entered yet: its pricing page and its Instagram and Facebook
 * accounts, which are stored for the next sources and the next check.
 */
async function checkPages(
  competitor: TrackedCompetitorRow,
  now: Date,
): Promise<SourceResult & { competitor: TrackedCompetitorRow }> {
  let current = competitor;
  if (!current.websiteUrl && !current.pricingUrl)
    return { ...skipped("ok"), competitor };
  try {
    const drafts: SignalDraft[] = [];
    let costUsd = 0;
    const { websiteUrl } = current;
    const home = websiteUrl ? await readCompetitorPage(websiteUrl) : null;
    // A competitor a member touched keeps the fields as they left them.
    if (home && websiteUrl && !current.memberEditedAt) {
      const found = {
        ...(current.pricingUrl
          ? {}
          : { pricingUrl: pricingLink(home.html, home.url) }),
        ...(current.instagramHandle
          ? {}
          : { instagramHandle: profileHandle(home.html, "instagram.com") }),
        ...(current.facebookHandle
          ? {}
          : { facebookHandle: profileHandle(home.html, "facebook.com") }),
      };
      const filled = Object.fromEntries(
        Object.entries(found).filter(([, value]) => value),
      );
      if (Object.keys(filled).length > 0) {
        const updated = await prisma.trackedCompetitor.updateMany({
          where: { id: current.id, memberEditedAt: null },
          data: filled,
        });
        if (updated.count > 0) current = { ...current, ...filled };
      }
    }
    if (home && websiteUrl) {
      const result = await checkPage(
        current,
        "WEBSITE",
        websiteUrl,
        home.lines,
        now,
      );
      drafts.push(...result.drafts);
      costUsd += result.costUsd;
    }
    if (current.pricingUrl && current.pricingUrl !== current.websiteUrl) {
      const pricing = await readCompetitorPage(current.pricingUrl);
      if (pricing) {
        const result = await checkPage(
          current,
          "PRICING",
          current.pricingUrl,
          pricing.lines,
          now,
        );
        drafts.push(...result.drafts);
        costUsd += result.costUsd;
      }
    }
    return { drafts, costUsd, status: "ok", competitor: current };
  } catch (error) {
    return { ...failed("pages", competitor, error), competitor: current };
  }
}

async function checkNews(
  competitor: TrackedCompetitorRow,
  projectId: string,
  now: Date,
): Promise<SourceResult> {
  if (!getEnv().EXA_API_KEY) return skipped("not_configured");
  try {
    const since = new Date(now.getTime() - WEEK_MS);
    const parsed = competitor.websiteUrl
      ? URL.parse(competitor.websiteUrl)
      : null;
    const site = parsed ? bareHost(parsed.hostname) : null;
    const found = await searchExa(
      {
        query: `${competitor.name}${site ? ` (${site})` : ""}: news, product launches, funding and announcements from the last week`,
        startPublishedDate: day(since),
        numResults: NEWS_RESULTS,
        excludeDomains: [...NEWS_JUNK_DOMAINS],
      },
      { userIdentifier: projectId },
    );
    const picked = await pickNews(
      competitor,
      competitorNews(competitor, found.results, { since, now }),
    );
    return {
      drafts: newsSignals(picked.news),
      costUsd: found.costUsd + picked.costUsd,
      status: "ok",
    };
  } catch (error) {
    return failed("news", competitor, error);
  }
}

/** Ad ids this competitor's earlier signals already hold. */
async function knownAdIds(competitorId: string): Promise<Set<string>> {
  const earlier = await prisma.competitorSignal.findMany({
    where: { competitorId, kind: "AD" },
    orderBy: { observedAt: "desc" },
    take: 8,
    select: { raw: true },
  });
  const adsSchema = z.object({ ads: z.array(z.object({ id: z.string() })) });
  return new Set(
    earlier.flatMap((signal) => {
      const parsed = adsSchema.safeParse(signal.raw);
      return parsed.success ? parsed.data.ads.map((ad) => ad.id) : [];
    }),
  );
}

async function checkAds(
  competitor: TrackedCompetitorRow,
  since: Date,
  now: Date,
): Promise<SourceResult> {
  if (!metaAdLibraryConfigured()) return skipped("not_configured");
  try {
    const [ads, known] = await Promise.all([
      searchMetaAds({
        name: competitor.name,
        facebookHandle: competitor.facebookHandle,
        since,
      }),
      knownAdIds(competitor.id),
    ]);
    const draft = adsSignal(
      ads.filter((ad) => !known.has(ad.id)),
      competitor.name,
      now,
    );
    return { drafts: draft ? [draft] : [], costUsd: 0, status: "ok" };
  } catch (error) {
    return failed("ads", competitor, error);
  }
}

async function checkSocial(
  competitor: TrackedCompetitorRow,
  reader: InstagramReader | null,
  now: Date,
): Promise<SourceResult> {
  if (!reader) return skipped("not_connected");
  if (!competitor.instagramHandle) return skipped("ok");
  try {
    const week = await readCompetitorInstagram({
      reader,
      handle: competitor.instagramHandle,
      now,
    });
    return {
      drafts: week ? [socialSignal(week, now)] : [],
      costUsd: 0,
      status: "ok",
    };
  } catch (error) {
    return failed("social", competitor, error);
  }
}

/**
 * The Project's own connected Instagram account: it looks other accounts up,
 * and its synced posts are the business's row on the scoreboard.
 */
export function projectInstagramConnection(projectId: string) {
  return prisma.projectSocialConnection.findFirst({
    where: { projectId, provider: "instagram", status: "active" },
    orderBy: { connectedAt: "desc" },
    select: {
      id: true,
      externalHandle: true,
      performanceHeadFetchedAt: true,
      composioConnectedAccountId: true,
      connectorUserId: true,
      externalAccountId: true,
    },
  });
}

/** The worst answer a source gave across the competitors. */
function overall(statuses: SourceStatus[]): SourceStatus {
  return (
    statuses.find((status) => status !== "ok" && status !== "failed") ??
    (statuses.includes("failed") ? "failed" : "ok")
  );
}

/**
 * The check to run now, if one is due: none yet, the last one about a week
 * old, or one that started over an hour ago and never finished (it is run
 * again under the same row, so it is charged once). Two callers on one day
 * get one row.
 */
async function claimCheck(
  projectId: string,
  now: Date,
): Promise<{ id: string; since: Date } | null> {
  const [latest, lastFinished] = await Promise.all([
    prisma.competitorCheck.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, finishedAt: true },
    }),
    prisma.competitorCheck.findFirst({
      where: { projectId, finishedAt: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const since = lastFinished?.createdAt ?? new Date(now.getTime() - WEEK_MS);
  const age = latest ? now.getTime() - latest.createdAt.getTime() : null;
  if (latest && age !== null) {
    if (!latest.finishedAt)
      return age > STALE_CHECK_MS ? { id: latest.id, since } : null;
    if (age < CHECK_EVERY_MS) return null;
  }
  try {
    const check = await prisma.competitorCheck.create({
      data: { projectId, day: day(now), createdAt: now },
      select: { id: true },
    });
    return { id: check.id, since };
  } catch (error) {
    if (isPrismaUniqueViolation(error)) return null;
    throw error;
  }
}

export type CompetitorCheckOutcome =
  | "checked"
  | "not_due"
  | "no_competitors"
  | "paused"
  | "unfunded";

/**
 * Runs a Cuso's weekly competitor check when one is due: fills the list
 * from the Brand Brain, charges the check, then reads each competitor's
 * pages, news, ads and Instagram and stores what is new as signals. A source
 * that fails is skipped for that competitor; the check still finishes.
 */
export async function runCompetitorCheck(
  cuso: Pick<Cuso, "sokoBotId" | "projectId">,
  now: Date = new Date(),
): Promise<CompetitorCheckOutcome> {
  const { projectId } = cuso;
  // Eval Cusos read the signals their case seeds; nothing real is fetched.
  if (await isEvalCusoProject(projectId)) return "paused";
  if (!(await isCmoSubscribed(cuso, now))) return "paused";
  await syncTrackedCompetitorsFromBrandBrain(projectId);
  const competitors = await listTrackedCompetitors(projectId);
  if (competitors.length === 0) return "no_competitors";
  const check = await claimCheck(projectId, now);
  if (!check) return "not_due";

  const charge = await chargeSokoBotCredits({
    sokoBotId: cuso.sokoBotId,
    key: `cmo-competitor-check:${check.id}`,
    credits: COMPETITOR_CHECK_CREDITS * competitors.length,
  });
  // Free hiring is charged nothing and still runs; an empty wallet does not.
  if (charge.chargedCents <= 0n && charge.shortfall) {
    await prisma.competitorCheck.delete({ where: { id: check.id } });
    return "unfunded";
  }
  if (charge.cusoProjectId)
    await notifyCusoLowCreditsAfterCharge(charge.cusoProjectId);

  const reader: InstagramReader | null =
    await projectInstagramConnection(projectId);
  const statuses: Record<CompetitorSource, SourceStatus[]> = {
    pages: [],
    news: [],
    ads: [],
    social: [],
  };
  // Side by side: one after another, five slow sites outlast the cron run.
  const checked = await Promise.all(
    competitors.map(async (listed) => {
      // Pages first: the homepage names the accounts the other sources read.
      const pages = await checkPages(listed, now);
      const competitor = pages.competitor;
      const [news, ads, social] = await Promise.all([
        checkNews(competitor, projectId, now),
        checkAds(competitor, check.since, now),
        checkSocial(competitor, reader, now),
      ]);
      const results = { pages, news, ads, social };
      const drafts = COMPETITOR_SOURCES.flatMap(
        (source) => results[source].drafts,
      );
      const created =
        drafts.length > 0
          ? await prisma.competitorSignal.createMany({
              data: drafts.map((draft) => ({
                ...draft,
                competitorId: competitor.id,
                projectId,
              })),
              skipDuplicates: true,
            })
          : { count: 0 };
      return { results, signals: created.count };
    }),
  );
  let costUsd = 0;
  let signalCount = 0;
  for (const { results, signals } of checked) {
    signalCount += signals;
    for (const source of COMPETITOR_SOURCES) {
      statuses[source].push(results[source].status);
      costUsd += results[source].costUsd;
    }
  }
  const sources: CompetitorCheckSources = {
    pages: { status: overall(statuses.pages) },
    news: { status: overall(statuses.news) },
    ads: { status: overall(statuses.ads) },
    social: { status: overall(statuses.social) },
  };
  await prisma.competitorCheck.update({
    where: { id: check.id },
    data: {
      finishedAt: new Date(),
      competitorCount: competitors.length,
      signalCount,
      sources,
      costUsd,
      chargedCents: charge.chargedCents,
    },
  });
  createCoreLogger({
    operation: "cmo_competitor_check",
    project: { id: projectId },
    competitorCheck: {
      id: check.id,
      competitors: competitors.length,
      signals: signalCount,
      costUsd,
      sources: Object.fromEntries(
        COMPETITOR_SOURCES.map((source) => [source, sources[source].status]),
      ),
    },
  }).emit();
  return "checked";
}

/** Cuso writes the week's feed from the check that just finished. */
async function startWatchRun(cuso: Cuso, now: Date): Promise<void> {
  const check = await prisma.competitorCheck.findFirst({
    where: {
      projectId: cuso.projectId,
      finishedAt: { gte: new Date(now.getTime() - WATCH_RUN_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!check) return;
  const { startCompetitorWatchRun } = await import(
    "@/services/cmo-competitor-feed.service"
  );
  await startCompetitorWatchRun(cuso, check.id).catch((error: unknown) =>
    // Busy, paused or out of credits: the signals wait for the next turn.
    recordCoreWarning(
      { operation: "cmo_competitor_watch", sokoBot: { id: cuso.sokoBotId } },
      {
        message: "Could not start Cuso's competitor watch",
        why: "Starting the turn that writes the week's competitor feed threw",
        fix: "The signals are stored; check_competitors shows them in Cuso's next turn. If it repeats, look up the error name and code under failure.",
      },
      { failure: messageSafeErrorFields(error) },
    ),
  );
}

/** Runs the weekly competitor check of every paid Cuso whose check is due. */
export async function syncCmoCompetitorChecks(
  shouldContinue: () => boolean = () => true,
  now: Date = new Date(),
): Promise<Record<CompetitorCheckOutcome | "failed", number>> {
  const counts = {
    checked: 0,
    not_due: 0,
    no_competitors: 0,
    paused: 0,
    unfunded: 0,
    failed: 0,
  };
  for (const cuso of await listCusosWithApprovedStrategy()) {
    if (!shouldContinue()) break;
    try {
      const outcome = await runCompetitorCheck(cuso, now);
      counts[outcome] += 1;
      // Also after "not_due": a run that could not start (Cuso busy or
      // paused) starts on a later sync, while its check is fresh.
      if (outcome === "checked" || outcome === "not_due")
        await startWatchRun(cuso, now);
    } catch (error) {
      counts.failed += 1;
      // The error can quote a page or an article.
      recordCoreWarning(
        { operation: "cmo_competitor_sync", sokoBot: { id: cuso.sokoBotId } },
        {
          message: "The competitor check skipped a Cuso",
          why: "Running this Cuso's competitor check threw",
          fix: "The next sync tries again; a check that started is redone after an hour and charged once. If it repeats, look up the error name and code under failure.",
        },
        { failure: messageSafeErrorFields(error) },
      );
    }
  }
  return counts;
}
