import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import { badRequest, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  socialAccountMetricSchema,
  socialAccountPostSchema,
  socialAccountStatisticsAccountSchema,
} from "@/schemas/social-account-statistics.schema";
import {
  type SocialPerformanceQuery,
  type SocialPerformanceResponse,
  type SocialPerformanceSummary,
  socialPerformanceQuerySchema,
  socialPerformanceResponseSchema,
  type WorkspaceSocialPerformanceResponse,
  workspaceSocialPerformanceQuerySchema,
  workspaceSocialPerformanceResponseSchema,
} from "@/schemas/social-performance.schema";
import { socialPostMetricsSchema } from "@/schemas/social-post-statistics.schema";
import { listSocialAccountStatistics } from "@/services/social-account-statistics.service";

type Post = z.infer<typeof socialAccountPostSchema>;
type Account = z.infer<typeof socialAccountStatisticsAccountSchema>;
type MetricKey = keyof Post["metrics"];
const METRIC_KEYS: MetricKey[] = [
  "views",
  "impressions",
  "likes",
  "comments",
  "shares",
  "saves",
];
const DAY = 86_400_000;
/** Collected posting history shown on the calendar, independent of the preset. */
const CONSISTENCY_DAYS = 365;
const MINIMUM_SAMPLE_SIZE = 10;
const snapshotSchema = z.object({
  connectionId: z.uuid(),
  date: dateTimeSchema,
  metrics: z.array(socialAccountMetricSchema),
  postMetrics: z.array(
    z.object({
      externalId: z.string(),
      metrics: socialPostMetricsSchema,
      additionalMetrics: z.array(socialAccountMetricSchema),
    }),
  ),
  fetchedAt: dateTimeSchema,
  profileFetchedAt: dateTimeSchema.nullable(),
});
type Snapshot = z.infer<typeof snapshotSchema>;

export interface ListSocialPerformanceInput
  extends Partial<SocialPerformanceQuery> {
  projectId: string;
  workspaceId: string;
  /** Exports reuse complete cohort aggregation and return all matching cached posts. */
  includeAllPosts?: boolean;
}

export interface ListWorkspaceSocialPerformanceInput
  extends Omit<ListSocialPerformanceInput, "projectId"> {
  projectId?: string;
}

function getRange(input: Partial<SocialPerformanceQuery>, now: Date) {
  const until = input.publishedUntil ? new Date(input.publishedUntil) : now;
  const from = input.publishedFrom
    ? new Date(input.publishedFrom)
    : new Date(until.getTime() - 30 * DAY + 1);
  const duration = until.getTime() - from.getTime() + 1;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 366 * DAY)
    throw badRequest(
      "Publication range must be ordered and no longer than 366 days",
    );
  return {
    from,
    until,
    previousFrom: new Date(from.getTime() - duration),
    previousUntil: new Date(from.getTime() - 1),
    baselineFrom: new Date(until.getTime() - 90 * DAY),
    baselineUntil: new Date(until.getTime() - 3 * DAY),
  };
}

function aggregate(values: Array<number | null>) {
  const measured = values
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
  const total = measured.length
    ? measured.reduce((sum, value) => sum + value, 0)
    : null;
  const middle = Math.floor(measured.length / 2);
  return {
    total,
    mean: total === null ? null : total / measured.length,
    median: !measured.length
      ? null
      : measured.length % 2
        ? measured[middle]
        : (measured[middle - 1] + measured[middle]) / 2,
    measuredPostCount: measured.length,
  };
}

function rateDefinition(provider: Post["provider"]) {
  return {
    denominator:
      provider === "x" || provider === "linkedin"
        ? ("impressions" as const)
        : ("views" as const),
    numeratorMetrics:
      provider === "x"
        ? ["likes", "comments", "shares", "quote_count"]
        : provider === "instagram"
          ? ["likes", "comments", "shares", "saves"]
          : ["likes", "comments", "shares"],
  };
}

function interactions(post: Post): number | null {
  const values = [
    post.metrics.likes,
    post.metrics.comments,
    post.metrics.shares,
  ];
  if (post.provider === "instagram") values.push(post.metrics.saves);
  if (post.provider === "x")
    values.push(
      post.additionalMetrics.find((metric) =>
        ["quote_count", "quotes"].includes(metric.key),
      )?.value ?? null,
    );
  // A partial numerator would make unmeasured engagement look like zero.
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function derive(post: Post) {
  const definition = rateDefinition(post.provider);
  const numerator = interactions(post);
  const exposure = post.metrics[definition.denominator];
  return {
    interactions: numerator,
    engagementDenominator: definition.denominator,
    engagementRate:
      numerator !== null && exposure !== null && exposure > 0
        ? (100 * numerator) / exposure
        : null,
  };
}

function summarize(posts: Post[]): SocialPerformanceSummary {
  const providers = [...new Set(posts.map((post) => post.provider))];
  const extra = new Map<
    string,
    {
      key: string;
      period: string | null;
      unit: string | null;
      values: Array<number | null>;
    }
  >();
  for (const post of posts) {
    for (const metric of post.additionalMetrics) {
      const period = metric.period?.startsWith("lifetime:")
        ? "lifetime"
        : metric.period;
      const identity = JSON.stringify([metric.key, period, metric.unit]);
      const group = extra.get(identity) ?? {
        key: metric.key,
        period,
        unit: metric.unit,
        values: [],
      };
      group.values.push(metric.value);
      extra.set(identity, group);
    }
  }
  return {
    postCount: posts.length,
    measuredPostCount: posts.filter(
      (post) =>
        Object.values(post.metrics).some((value) => value !== null) ||
        post.additionalMetrics.some((metric) => metric.value !== null),
    ).length,
    metrics: {
      views: aggregate(posts.map((post) => post.metrics.views)),
      impressions: aggregate(posts.map((post) => post.metrics.impressions)),
      likes: aggregate(posts.map((post) => post.metrics.likes)),
      comments: aggregate(posts.map((post) => post.metrics.comments)),
      shares: aggregate(posts.map((post) => post.metrics.shares)),
      saves: aggregate(posts.map((post) => post.metrics.saves)),
    },
    interactions: aggregate(posts.map(interactions)),
    engagementRates: providers.map((provider) => {
      const definition = rateDefinition(provider);
      const measured = posts
        .filter((post) => post.provider === provider)
        .filter((post) => derive(post).engagementRate !== null);
      const numerator = aggregate(measured.map(interactions)).total;
      const exposure = aggregate(
        measured.map((post) => post.metrics[definition.denominator]),
      ).total;
      const rates = aggregate(
        measured.map((post) => derive(post).engagementRate),
      );
      return {
        provider,
        ...definition,
        interactions: numerator,
        exposure,
        rate:
          numerator !== null && exposure !== null && exposure > 0
            ? (100 * numerator) / exposure
            : null,
        mean: rates.mean,
        median: rates.median,
        measuredPostCount: measured.length,
      };
    }),
    additionalMetrics: [...extra.values()].map(({ values, ...metric }) => {
      const stats = aggregate(values);
      // Durations/rates that are already averages cannot be added across posts.
      const additive =
        metric.unit !== "percent" &&
        !/(?:average|avg|_rate$|Percentage$)/i.test(metric.key);
      return {
        ...metric,
        aggregate: { ...stats, total: additive ? stats.total : null },
      };
    }),
  };
}

function matches(post: Post, query: Partial<SocialPerformanceQuery>) {
  const kind = query.postKind ?? "posts";
  return (
    (!query.search ||
      post.text
        .toLocaleLowerCase()
        .includes(query.search.toLocaleLowerCase())) &&
    (!query.contentType || post.contentType === query.contentType) &&
    (kind === "all" ||
      (kind === "posts" &&
        post.postKind !== "reply" &&
        post.postKind !== "repost") ||
      (kind === "replies" && post.postKind === "reply") ||
      (kind === "quotes" && post.postKind === "quote") ||
      (kind === "reposts" && post.postKind === "repost"))
  );
}

function groupPosts(posts: Post[], key: (post: Post) => string) {
  const result = new Map<string, Post[]>();
  for (const post of posts) {
    const identity = key(post);
    const group = result.get(identity) ?? [];
    group.push(post);
    result.set(identity, group);
  }
  return result;
}

function absoluteDelta(current: number | null, previous: number | null) {
  return current !== null && previous !== null ? current - previous : null;
}

function inPublicationRange(post: Post, from: Date, until: Date) {
  return (
    post.publishedAt !== null &&
    new Date(post.publishedAt) >= from &&
    new Date(post.publishedAt) <= until
  );
}

function postIdentity(post: Post) {
  return JSON.stringify([post.provider, post.externalId]);
}

function uniquePosts(posts: Post[]) {
  const latest = new Map<string, Post>();
  for (const post of posts) {
    const key = postIdentity(post);
    const previous = latest.get(key);
    const order =
      new Date(post.fetchedAt ?? 0).getTime() -
        new Date(previous?.fetchedAt ?? 0).getTime() ||
      post.id.localeCompare(previous?.id ?? "");
    if (!previous || order > 0) latest.set(key, post);
  }
  return [...latest.values()];
}

function shiftIsoDate(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Posting days for the calendar. The preset cohort stays on `daily`. */
function buildConsistency(input: {
  posts: Post[];
  postKind: SocialPerformanceQuery["postKind"] | undefined;
  endDate: string;
  selectedFrom: string;
  selectedUntil: string;
  localDate: (value: string | Date) => string;
}): SocialPerformanceResponse["consistency"] {
  const capDate = shiftIsoDate(input.endDate, -CONSISTENCY_DAYS);
  const groups = groupPosts(
    input.posts.filter((post) => {
      if (!post.publishedAt || !matches(post, { postKind: input.postKind }))
        return false;
      const date = input.localDate(post.publishedAt);
      return date >= capDate && date <= input.endDate;
    }),
    (post) => input.localDate(post.publishedAt ?? input.endDate),
  );
  const from = [...groups.keys()].sort()[0] ?? null;
  const daily: SocialPerformanceResponse["consistency"]["daily"] = [];
  if (from) {
    for (
      let day = new Date(`${from}T12:00:00Z`);
      day.toISOString().slice(0, 10) <= input.endDate;
      day = new Date(day.getTime() + DAY)
    ) {
      const date = day.toISOString().slice(0, 10);
      const posts = groups.get(date) ?? [];
      const measured = aggregate(posts.map(interactions)).total;
      daily.push({
        date,
        postCount: posts.length,
        interactions: posts.length === 0 ? 0 : measured,
      });
    }
  }
  return {
    from,
    until: from ? input.endDate : null,
    selectedFrom: input.selectedFrom,
    selectedUntil: input.selectedUntil,
    daily,
  };
}

/** Pure aggregation of verified cache data. Publication cohorts are not event-time analytics. */
export function buildSocialPerformance(input: {
  accounts: Account[];
  posts: Post[];
  snapshots: Snapshot[];
  query: Partial<SocialPerformanceQuery>;
  now?: Date;
  missingPublicationDateCount?: number;
  includeAllPosts?: boolean;
  deduplicatePosts?: boolean;
}): SocialPerformanceResponse {
  const range = getRange(input.query, input.now ?? new Date());
  const timezone = input.query.timezone ?? "UTC";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  function localParts(value: string | Date) {
    const parts = formatter.formatToParts(new Date(value));
    const part = (key: string) =>
      parts.find((item) => item.type === key)?.value ?? "";
    const date = `${part("year")}-${part("month")}-${part("day")}`;
    return {
      date,
      hour: Number(part("hour")),
      weekday: (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7,
    };
  }
  const selectedIds = new Set(input.accounts.map((account) => account.id));
  const selectedPosts = input.posts.filter((post) =>
    selectedIds.has(post.connectionId),
  );
  const filtered = selectedPosts.filter((post) => matches(post, input.query));
  const cohortPosts = input.deduplicatePosts
    ? uniquePosts(selectedPosts).filter((post) => matches(post, input.query))
    : filtered;
  const inRange = inPublicationRange;
  const currentCopies = filtered.filter((post) =>
    inRange(post, range.from, range.until),
  );
  const current = cohortPosts.filter((post) =>
    inRange(post, range.from, range.until),
  );
  const previous = cohortPosts.filter((post) =>
    inRange(post, range.previousFrom, range.previousUntil),
  );
  const currentSummary = summarize(current);
  const previousSummary = summarize(previous);
  const deltas: SocialPerformanceResponse["summary"]["deltas"] = {
    postCount: current.length - previous.length,
    views: null,
    impressions: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    interactions: null,
  };
  // Compare complete measured cohorts only. Partial sums can reflect missing permissions rather than growth.
  for (const key of METRIC_KEYS) {
    const present = currentSummary.metrics[key];
    const past = previousSummary.metrics[key];
    if (
      present.measuredPostCount === current.length &&
      past.measuredPostCount === previous.length
    )
      deltas[key] = absoluteDelta(present.total, past.total);
  }
  if (
    currentSummary.interactions.measuredPostCount === current.length &&
    previousSummary.interactions.measuredPostCount === previous.length
  )
    deltas.interactions = absoluteDelta(
      currentSummary.interactions.total,
      previousSummary.interactions.total,
    );

  const now = input.now ?? new Date();
  const consistency = buildConsistency({
    posts: input.deduplicatePosts ? uniquePosts(selectedPosts) : selectedPosts,
    postKind: input.query.postKind,
    endDate: localParts(now).date,
    selectedFrom: localParts(range.from).date,
    selectedUntil: localParts(range.until).date,
    localDate: (value) => localParts(value).date,
  });
  const dailyGroups = groupPosts(
    current,
    (post) => localParts(post.publishedAt ?? range.from).date,
  );
  const firstDay = localParts(range.from).date;
  const lastDay = localParts(range.until).date;
  const daily: SocialPerformanceResponse["daily"] = [];
  for (
    let day = new Date(`${firstDay}T12:00:00Z`);
    day.toISOString().slice(0, 10) <= lastDay;
    day = new Date(day.getTime() + DAY)
  ) {
    const date = day.toISOString().slice(0, 10);
    daily.push({ date, summary: summarize(dailyGroups.get(date) ?? []) });
  }
  const heatmapGroups = groupPosts(current, (post) => {
    const parts = localParts(post.publishedAt ?? range.from);
    return `${parts.weekday}:${parts.hour}`;
  });
  const cells: SocialPerformanceResponse["heatmap"]["cells"] = [];
  const heatmapProviders = [...new Set(current.map((post) => post.provider))];
  const comparisonProvider =
    heatmapProviders.length === 1 ? heatmapProviders[0] : null;
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      const posts = heatmapGroups.get(`${weekday}:${hour}`) ?? [];
      const counts = aggregate(posts.map(interactions));
      const rates = aggregate(posts.map((post) => derive(post).engagementRate));
      cells.push({
        weekday,
        hour,
        postCount: posts.length,
        measuredPostCount: counts.measuredPostCount,
        meanInteractions: comparisonProvider === null ? null : counts.mean,
        meanEngagementRate: comparisonProvider === null ? null : rates.mean,
      });
    }
  }
  const baselines = groupPosts(
    input.posts.filter(
      (post) =>
        selectedIds.has(post.connectionId) &&
        (post.postKind === "post" || post.postKind === "quote") &&
        inRange(post, range.baselineFrom, range.baselineUntil),
    ),
    (post) => post.connectionId,
  );
  const baselineSamples = new Map(
    [...baselines].map(([connectionId, group]) => {
      const values = group
        .map(interactions)
        .filter((value) => value !== null)
        .sort((a, b) => a - b);
      const indices = new Map<number, number>();
      values.forEach((value, index) => {
        if (!indices.has(value)) indices.set(value, index);
      });
      return [connectionId, { values, indices }];
    }),
  );
  const posts = current.map((post) => {
    const derived = derive(post);
    const baseline = baselineSamples.get(post.connectionId);
    const values = baseline?.values ?? [];
    const excludedIndex =
      derived.interactions !== null &&
      inRange(post, range.baselineFrom, range.baselineUntil) &&
      (post.postKind === "post" || post.postKind === "quote")
        ? baseline?.indices.get(derived.interactions)
        : undefined;
    const sampleSize = values.length - (excludedIndex === undefined ? 0 : 1);
    const middle = Math.floor(sampleSize / 2);
    const at = (index: number) =>
      values[
        index + (excludedIndex !== undefined && excludedIndex <= index ? 1 : 0)
      ];
    const median =
      sampleSize === 0
        ? null
        : sampleSize % 2
          ? at(middle)
          : (at(middle - 1) + at(middle)) / 2;
    return {
      ...post,
      ...derived,
      baselineSampleSize: sampleSize,
      baselineMultiplier:
        derived.interactions !== null &&
        sampleSize >= MINIMUM_SAMPLE_SIZE &&
        median !== null &&
        median > 0
          ? derived.interactions / median
          : null,
    };
  });
  const sort = input.query.sort ?? "interactions";
  posts.sort((a, b) => {
    const left =
      sort === "publishedAt"
        ? new Date(a.publishedAt ?? 0).getTime()
        : sort in a.metrics
          ? a.metrics[sort as MetricKey]
          : a[sort as "interactions" | "engagementRate" | "baselineMultiplier"];
    const right =
      sort === "publishedAt"
        ? new Date(b.publishedAt ?? 0).getTime()
        : sort in b.metrics
          ? b.metrics[sort as MetricKey]
          : b[sort as "interactions" | "engagementRate" | "baselineMultiplier"];
    return (
      (left === null
        ? right === null
          ? 0
          : 1
        : right === null
          ? -1
          : right - left) ||
      new Date(b.publishedAt ?? 0).getTime() -
        new Date(a.publishedAt ?? 0).getTime() ||
      b.id.localeCompare(a.id)
    );
  });
  const snapshots = input.snapshots
    .filter(
      (snapshot) =>
        selectedIds.has(snapshot.connectionId) &&
        new Date(snapshot.fetchedAt) >= range.from &&
        new Date(snapshot.fetchedAt) <= range.until,
    )
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
  const followers = input.accounts.map((account) => {
    const points = input.snapshots
      .filter(
        (snapshot) =>
          snapshot.connectionId === account.id &&
          snapshot.profileFetchedAt !== null &&
          new Date(snapshot.profileFetchedAt) >= range.from &&
          new Date(snapshot.profileFetchedAt) <= range.until,
      )
      .map((snapshot) => ({
        date: localParts(snapshot.profileFetchedAt ?? snapshot.fetchedAt).date,
        fetchedAt: snapshot.profileFetchedAt ?? snapshot.fetchedAt,
        value:
          snapshot.metrics.find((metric) =>
            [
              "followers",
              "followers_count",
              "follower_count",
              "subscriberCount",
              "subscribers",
            ].includes(metric.key),
          )?.value ?? null,
      }))
      .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
    const measured = points.flatMap((point) =>
      point.value === null ? [] : [point.value],
    );
    return {
      connectionId: account.id,
      provider: account.provider,
      points,
      change:
        measured.length >= 2
          ? measured[measured.length - 1] - measured[0]
          : null,
    };
  });
  const postIdentities = new Map(
    currentCopies.map((post) => [
      JSON.stringify([post.connectionId, post.externalId]),
      post,
    ]),
  );
  const observations = snapshots.map((snapshot) => {
    const measuredPosts = snapshot.postMetrics.flatMap((observed) => {
      const original = postIdentities.get(
        JSON.stringify([snapshot.connectionId, observed.externalId]),
      );
      return original
        ? [
            {
              ...original,
              metrics: observed.metrics,
              additionalMetrics: observed.additionalMetrics,
            },
          ]
        : [];
    });
    return {
      connectionId: snapshot.connectionId,
      date: localParts(snapshot.fetchedAt).date,
      fetchedAt: snapshot.fetchedAt,
      summary: summarize(measuredPosts),
    };
  });
  const fetchedDates = input.accounts
    .flatMap((account) =>
      [
        account.statistics?.fetchedAt,
        account.statistics?.historyFetchedAt,
      ].filter((value): value is string => typeof value === "string"),
    )
    .sort();
  const limit = input.includeAllPosts
    ? posts.length
    : (input.query.limit ?? 100);
  const offset = input.includeAllPosts ? 0 : (input.query.offset ?? 0);
  return socialPerformanceResponseSchema.parse({
    range: {
      publishedFrom: range.from,
      publishedUntil: range.until,
      previousFrom: range.previousFrom,
      previousUntil: range.previousUntil,
      timezone,
      semantics: "lifetime_metrics_by_publication_cohort",
    },
    accounts: input.accounts,
    summary: { current: currentSummary, previous: previousSummary, deltas },
    daily,
    consistency,
    comparisons: {
      accounts: input.accounts.map((account) => ({
        connectionId: account.id,
        provider: account.provider,
        summary: summarize(
          currentCopies.filter((post) => post.connectionId === account.id),
        ),
      })),
      providers: [...groupPosts(current, (post) => post.provider)].map(
        ([, group]) => ({
          provider: group[0].provider,
          summary: summarize(group),
        }),
      ),
      formats: [...groupPosts(current, (post) => post.contentType)].map(
        ([, group]) => ({
          contentType: group[0].contentType,
          summary: summarize(group),
        }),
      ),
    },
    heatmap: {
      timezone,
      comparisonProvider,
      postCount: current.length,
      minimumSampleSize: MINIMUM_SAMPLE_SIZE,
      cells,
    },
    followers,
    observations,
    baseline: {
      windowDays: 90,
      excludeRecentDays: 3,
      minimumSampleSize: MINIMUM_SAMPLE_SIZE,
      metric: "interactions",
      comparison: "same_account_median",
    },
    posts: posts.slice(offset, offset + limit),
    pagination: {
      limit,
      offset,
      nextOffset: offset + limit < posts.length ? offset + limit : null,
      total: posts.length,
      truncated: posts.length > limit,
    },
    coverage: {
      historyComplete: input.accounts.every(
        (account) => account.statistics?.historyComplete === true,
      ),
      lastFetchedAt: fetchedDates.at(-1) ?? null,
      missingPublicationDateCount:
        input.missingPublicationDateCount ??
        filtered.filter((post) => post.publishedAt === null).length,
      historicalSnapshotsAvailable: snapshots.length > 0,
      unknownPostKindCount: current.filter(
        (post) => post.postKind === "unknown",
      ).length,
      unknownContentTypeCount: current.filter(
        (post) => post.contentType === "unknown",
      ).length,
    },
  });
}

/** Scope authorization before direct cache reads; never fetch providers on this GET. */
export async function listSocialPerformance(
  input: ListSocialPerformanceInput,
): Promise<SocialPerformanceResponse> {
  const parsedQuery = socialPerformanceQuerySchema.safeParse(input);
  if (!parsedQuery.success)
    throw badRequest(
      parsedQuery.error.issues[0]?.message ?? "Invalid performance query",
    );
  const query = parsedQuery.data;
  const now = new Date();
  const range = getRange(query, now);
  const page = await listSocialAccountStatistics({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    connectionId: query.connectionId,
    provider: query.provider,
    limit: 1,
  });
  const accounts = page.accounts.filter(
    (account) =>
      (!query.provider || account.provider === query.provider) &&
      (!query.connectionId || account.id === query.connectionId),
  );
  const cache = await readSocialPerformanceCache({
    accounts,
    query,
    range,
    now,
    projectIds: [input.projectId],
    workspaceId: input.workspaceId,
    includeAllPosts: input.includeAllPosts,
  });
  return buildSocialPerformance({ ...cache, now });
}

/** Each project passes the existing account-read scope guard before combining raw cohorts. */
export async function listWorkspaceSocialPerformance(
  input: ListWorkspaceSocialPerformanceInput,
): Promise<WorkspaceSocialPerformanceResponse> {
  const parsedQuery = workspaceSocialPerformanceQuerySchema.safeParse(input);
  if (!parsedQuery.success)
    throw badRequest(
      parsedQuery.error.issues[0]?.message ?? "Invalid performance query",
    );
  const query = parsedQuery.data;
  const now = new Date();
  const range = getRange(query, now);
  const projects = await prisma.project.findMany({
    where: {
      workspaceId: input.workspaceId,
    },
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  if (
    query.projectId &&
    !projects.some((project) => project.id === query.projectId)
  )
    throw notFound("Project not found");
  const pages = await Promise.all(
    projects.map((project) =>
      listSocialAccountStatistics({
        projectId: project.id,
        workspaceId: input.workspaceId,
        limit: 1,
      }),
    ),
  );
  const allAccounts = pages.flatMap((page, index) =>
    !query.projectId || projects[index].id === query.projectId
      ? page.accounts
      : [],
  );
  if (
    query.connectionId &&
    !allAccounts.some((account) => account.id === query.connectionId)
  )
    throw notFound("Project social connection not found");
  const accounts = allAccounts.filter(
    (account) =>
      (!query.provider || account.provider === query.provider) &&
      (!query.connectionId || account.id === query.connectionId),
  );
  const attribution = projects.map((project, index) => ({
    ...project,
    connectionIds: pages[index].accounts.map((account) => account.id),
  }));
  const cache = await readSocialPerformanceCache({
    accounts,
    query,
    range,
    now,
    projectIds: projects
      .filter((project) => !query.projectId || project.id === query.projectId)
      .map((project) => project.id),
    workspaceId: input.workspaceId,
    includeAllPosts: input.includeAllPosts,
  });
  const response = buildSocialPerformance({
    ...cache,
    now,
    deduplicatePosts: true,
  });
  const currentUniquePosts = uniquePosts(cache.posts).filter(
    (post) =>
      matches(post, query) && inPublicationRange(post, range.from, range.until),
  );
  const currentIdentities = new Set(currentUniquePosts.map(postIdentity));
  const currentPosts = cache.posts.filter((post) =>
    currentIdentities.has(postIdentity(post)),
  );
  const projectsByPost = new Map<string, Set<string>>();
  const projectByConnection = new Map<string, string>();
  for (const project of attribution)
    for (const id of project.connectionIds)
      projectByConnection.set(id, project.id);
  for (const post of currentPosts) {
    const projectId = projectByConnection.get(post.connectionId);
    if (!projectId) continue;
    const ids = projectsByPost.get(postIdentity(post)) ?? new Set<string>();
    ids.add(projectId);
    projectsByPost.set(postIdentity(post), ids);
  }
  return workspaceSocialPerformanceResponseSchema.parse({
    ...response,
    workspaceId: input.workspaceId,
    projects: attribution,
    posts: response.posts.map((post) => ({
      ...post,
      projectIds: [...(projectsByPost.get(postIdentity(post)) ?? [])].sort(),
    })),
    coverage: {
      ...response.coverage,
      duplicatePostCopiesExcluded:
        currentPosts.length - response.summary.current.postCount,
      deduplicationBasis: "provider_external_post_id",
    },
    comparisons: {
      ...response.comparisons,
      projects: attribution
        .filter((project) => !query.projectId || project.id === query.projectId)
        .map((project) => ({
          projectId: project.id,
          summary: summarize(
            uniquePosts(
              cache.posts.filter((post) =>
                project.connectionIds.includes(post.connectionId),
              ),
            ).filter(
              (post) =>
                matches(post, query) &&
                inPublicationRange(post, range.from, range.until),
            ),
          ),
        })),
    },
  });
}

async function readSocialPerformanceCache(input: {
  accounts: Account[];
  query: SocialPerformanceQuery;
  range: ReturnType<typeof getRange>;
  now: Date;
  projectIds: string[];
  workspaceId: string;
  includeAllPosts?: boolean;
}) {
  const { accounts, query, range } = input;
  const connectionId = { in: accounts.map((account) => account.id) };
  const presetEarliest =
    range.previousFrom < range.baselineFrom
      ? range.previousFrom
      : range.baselineFrom;
  const consistencyFrom = new Date(
    input.now.getTime() - (CONSISTENCY_DAYS + 2) * DAY,
  );
  const earliest =
    consistencyFrom < presetEarliest ? consistencyFrom : presetEarliest;
  const latest = range.until > input.now ? range.until : input.now;
  const scope = {
    connectionId,
    connection: {
      projectId:
        input.projectIds.length === 1
          ? input.projectIds[0]
          : { in: input.projectIds },
      project: { workspaceId: input.workspaceId },
    },
  };
  const [rows, snapshots, missingPublicationDateCount] = await Promise.all([
    prisma.socialAccountPost.findMany({
      where: { ...scope, publishedAt: { gte: earliest, lte: latest } },
      include: { connection: { select: { provider: true } } },
    }),
    prisma.socialPerformanceSnapshot.findMany({
      where: {
        ...scope,
        date: {
          gte: new Date(range.from.toISOString().slice(0, 10)),
          lte: range.until,
        },
      },
      orderBy: [{ date: "asc" }, { connectionId: "asc" }],
    }),
    prisma.socialAccountPost.count({ where: { ...scope, publishedAt: null } }),
  ]);
  return {
    accounts,
    posts: rows.map((row) =>
      socialAccountPostSchema.parse({
        ...row,
        provider: row.connection.provider,
      }),
    ),
    snapshots: snapshots.flatMap((row) => {
      const parsed = snapshotSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    }),
    query: {
      ...query,
      publishedFrom: range.from.toISOString(),
      publishedUntil: range.until.toISOString(),
    },
    missingPublicationDateCount,
    includeAllPosts: input.includeAllPosts,
  };
}
