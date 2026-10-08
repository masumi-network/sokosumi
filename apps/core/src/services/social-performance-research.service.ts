import { randomUUID } from "node:crypto";
import { z } from "@hono/zod-openapi";
import { record } from "@/clients/composio.client";
import {
  parseXAccountPosts,
  readNativeStatistics,
  type SocialAccountStatisticsContext,
} from "@/clients/social-post-providers/account-statistics";
import { badRequest, notFound, serviceUnavailable } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  socialAccountPostSchema,
  socialAccountStatisticsAccountSchema,
} from "@/schemas/social-account-statistics.schema";
import {
  socialPerformanceAudienceQuerySchema,
  socialPerformanceAudienceResponseSchema,
  socialPerformanceBenchmarkQuerySchema,
  socialPerformanceBenchmarkResponseSchema,
  socialPerformanceContactSchema,
  socialPerformanceDiscoveryQuerySchema,
  socialPerformanceDiscoveryResponseSchema,
  socialPerformancePublicPostSchema,
} from "@/schemas/social-performance-research.schema";
import { listProjectSocialConnections } from "@/services/project-social-connections.service";
import { buildSocialPerformance } from "@/services/social-performance.service";

interface Scope {
  projectId: string;
  workspaceId: string;
  connectionId: string;
}
interface Parameter {
  name: string;
  value: string;
  type: "query";
}
type Contact = z.infer<typeof socialPerformanceContactSchema>;
const query = (name: string, value: string): Parameter => ({
  name,
  value,
  type: "query",
});
const userFields = query(
  "user.fields",
  "description,location,profile_image_url,public_metrics,protected",
);

export async function scopedXConnection(input: Scope, postId?: string) {
  const accounts = await listProjectSocialConnections(input);
  const account = accounts.find((value) => value.id === input.connectionId);
  if (!account) throw notFound("Project social connection not found");
  if (account.provider !== "x")
    throw badRequest(
      "Audience and public benchmarking currently require an X connection",
    );
  if (account.status !== "active")
    throw badRequest(
      "Reconnect the X account before reading audience or benchmark data",
    );
  const selectedPost = postId
    ? await prisma.socialAccountPost.findFirst({
        where: {
          id: postId,
          connectionId: input.connectionId,
          connection: {
            projectId: input.projectId,
            project: { workspaceId: input.workspaceId },
            provider: "x",
            status: "active",
          },
        },
        select: { externalId: true, publishedAt: true, postKind: true },
      })
    : null;
  if (
    postId &&
    (!selectedPost ||
      typeof selectedPost.externalId !== "string" ||
      !/^\d{1,19}$/.test(selectedPost.externalId) ||
      selectedPost.postKind === "repost")
  )
    throw notFound("Selected X post not found in this project account");
  const connection = await prisma.projectSocialConnection.findFirst({
    where: {
      id: input.connectionId,
      projectId: input.projectId,
      project: { workspaceId: input.workspaceId },
      provider: "x",
      status: "active",
    },
  });
  if (!connection || !/^\d{1,19}$/.test(connection.externalAccountId))
    throw notFound("Project social connection not found");
  const context: SocialAccountStatisticsContext = {
    provider: "x",
    connectedAccountId: connection.composioConnectedAccountId,
    executorUserId: connection.connectorUserId,
    externalAccountId: connection.externalAccountId,
    externalHandle: connection.externalHandle,
    cursor: null,
    includeProfile: false,
  };
  return { account, context, selectedPost };
}

function objects(value: unknown) {
  return Array.isArray(value)
    ? value.map(record).filter((item) => item !== null)
    : [];
}
function nullableCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
function safeUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}
function contact(user: Record<string, unknown>): Contact | null {
  if (
    typeof user.id !== "string" ||
    !/^\d{1,19}$/.test(user.id) ||
    typeof user.username !== "string" ||
    !/^[A-Za-z0-9_]{1,15}$/.test(user.username) ||
    typeof user.name !== "string"
  )
    return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    description: typeof user.description === "string" ? user.description : null,
    location: typeof user.location === "string" ? user.location : null,
    avatarUrl: safeUrl(user.profile_image_url),
    followersCount: nullableCount(record(user.public_metrics)?.followers_count),
    interactions: null,
    replies: null,
    quotes: null,
    mentions: null,
    likes: null,
    reposts: null,
  };
}
function nextCursor(data: Record<string, unknown>): string | null {
  const value = record(data.meta)?.next_token;
  if (value === undefined || value === null) return null;
  return socialPerformanceAudienceQuerySchema.shape.cursor.parse(value) ?? null;
}
function postDate(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !z.iso.datetime({ offset: true }).safeParse(value).success
  )
    return null;
  return new Date(value).toISOString();
}

function publicPostEvidence(
  item: Record<string, unknown>,
  data: Record<string, unknown>,
  connectionId: string,
  observedAt: Date,
  interactionType: "reply" | "quote" | "mention" | null = null,
) {
  const authorId = typeof item.author_id === "string" ? item.author_id : null;
  if (!authorId || !/^\d{1,19}$/.test(authorId)) return null;
  const [post] = parseXAccountPosts(
    { data: [item], includes: data.includes },
    authorId,
  );
  if (!post) return null;
  const user = objects(record(data.includes)?.users).find(
    (value) => value.id === authorId,
  );
  if (user?.protected === true) return null;
  return socialPerformancePublicPostSchema.parse({
    author: user ? contact(user) : null,
    post: {
      ...post,
      id: randomUUID(),
      connectionId,
      provider: "x",
      fetchedAt: observedAt,
      additionalMetrics: post.additionalMetrics.filter(
        (value) => value.key === "quote_count",
      ),
    },
    interactionType,
  });
}

/** Public relationship data is returned for the selected account and is never stored as an audience database. */
export async function readSocialPerformanceAudience(
  input: Scope & Partial<z.infer<typeof socialPerformanceAudienceQuerySchema>>,
) {
  const request = socialPerformanceAudienceQuerySchema.parse(input);
  const postAudience =
    request.kind === "likers" || request.kind === "reposters";
  const { context, selectedPost } = await scopedXConnection(
    input,
    postAudience ? request.postId : undefined,
  );
  const parameters = [query("max_results", String(request.limit)), userFields];
  if (request.cursor)
    parameters.push(query("pagination_token", request.cursor));
  if (request.kind === "mentions") {
    parameters.push(
      query("post.fields", "created_at,public_metrics"),
      query("expansions", "author_id,in_reply_to_user_id,referenced_posts"),
    );
  }
  try {
    const data = await readNativeStatistics(
      context,
      postAudience && selectedPost
        ? `https://api.x.com/2/tweets/${selectedPost.externalId}/${request.kind === "likers" ? "liking_users" : "retweeted_by"}`
        : `https://api.x.com/2/users/${context.externalAccountId}/${request.kind}`,
      parameters,
    );
    const rows = objects(data.data);
    if (!Array.isArray(data.data) && record(data.meta)?.result_count !== 0)
      throw new TypeError("Invalid audience response");
    if (rows.length > request.limit)
      throw new TypeError("Invalid audience page");
    const contacts = new Map<string, Contact>();
    const interactionTypes = new Map<string, "reply" | "quote" | "mention">();
    const observedAt = new Date();
    if (request.kind !== "mentions") {
      for (const user of rows) {
        const value = contact(user);
        if (value)
          contacts.set(
            value.id,
            postAudience
              ? {
                  ...value,
                  interactions: 1,
                  likes: request.kind === "likers" ? 1 : null,
                  reposts: request.kind === "reposters" ? 1 : null,
                }
              : value,
          );
      }
    } else {
      const users = objects(record(data.includes)?.users);
      const referencedPosts = objects(
        record(data.includes)?.posts ?? record(data.includes)?.tweets,
      );
      for (const post of rows) {
        if (post.author_id === context.externalAccountId) continue;
        if (typeof post.id !== "string" || interactionTypes.has(post.id))
          continue;
        const user = users.find((item) => item.id === post.author_id);
        if (user?.protected === true) continue;
        const references = objects(
          post.referenced_posts ?? post.referenced_tweets,
        );
        const referencesOwnPost = (type: string) =>
          references.some(
            (reference) =>
              reference.type === type &&
              referencedPosts.some(
                (item) =>
                  item.id === reference.id &&
                  item.author_id === context.externalAccountId,
              ),
          );
        const kind =
          post.in_reply_to_user_id === context.externalAccountId ||
          referencesOwnPost("replied_to")
            ? "replies"
            : referencesOwnPost("quoted")
              ? "quotes"
              : "mentions";
        interactionTypes.set(
          post.id,
          kind === "replies"
            ? "reply"
            : kind === "quotes"
              ? "quote"
              : "mention",
        );
        const value = user ? contact(user) : null;
        if (!value) continue;
        const current = contacts.get(value.id) ?? {
          ...value,
          interactions: 0,
          replies: 0,
          quotes: 0,
          mentions: 0,
        };
        current.interactions = (current.interactions ?? 0) + 1;
        current[kind] = (current[kind] ?? 0) + 1;
        contacts.set(value.id, current);
      }
    }
    const dates = rows
      .map((item) => postDate(item.created_at))
      .filter((value) => value !== null)
      .sort();
    return socialPerformanceAudienceResponseSchema.parse({
      kind: request.kind,
      postId: postAudience ? request.postId : null,
      posts:
        request.kind === "mentions"
          ? rows
              .filter(
                (item) =>
                  typeof item.id === "string" && interactionTypes.has(item.id),
              )
              .filter(
                (item, index, values) =>
                  values.findIndex((value) => value.id === item.id) === index,
              )
              .map((item) =>
                publicPostEvidence(
                  item,
                  data,
                  input.connectionId,
                  observedAt,
                  interactionTypes.get(String(item.id)) ?? null,
                ),
              )
              .filter((value) => value !== null)
          : [],
      contacts: [...contacts.values()].sort(
        (left, right) => (right.interactions ?? 0) - (left.interactions ?? 0),
      ),
      nextCursor: nextCursor(data),
      observedAt,
      samplePostCount: postAudience
        ? 1
        : request.kind === "mentions"
          ? rows.length
          : 0,
      oldestPostAt: postAudience
        ? selectedPost?.publishedAt
        : (dates.at(0) ?? null),
      newestPostAt: postAudience
        ? selectedPost?.publishedAt
        : (dates.at(-1) ?? null),
      coverage:
        request.kind === "mentions"
          ? "Counts describe this page of public mentions, replies and quotes. X exposes up to 800 recent mentions; this is not a complete audience ranking or a 90-day history. Profile locations are self-reported."
          : postAudience
            ? `This page lists public ${request.kind} visible for the selected account's post. Counts describe one post, not a complete account audience ranking. It does not identify when these actions occurred. Profile locations are self-reported.`
            : "This page lists public followers visible through the connected account. It does not identify when they followed, their age, gender, or a complete demographic breakdown. Profile locations are self-reported.",
    });
  } catch {
    throw serviceUnavailable(
      "X audience data is unavailable. Check connection scopes, API access and rate limits, then try again.",
    );
  }
}

/** The target is a validated X handle; only its public data is read through the authorized connection. */
export async function readSocialPerformanceBenchmark(
  input: Scope & { username: string },
) {
  const { username } = socialPerformanceBenchmarkQuerySchema.parse(input);
  const { account, context } = await scopedXConnection(input);
  const now = new Date();
  const publishedFrom = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  try {
    const lookup = await readNativeStatistics(
      context,
      `https://api.x.com/2/users/by/username/${username}`,
      [userFields],
    );
    const user = record(lookup.data);
    const profile = user ? contact(user) : null;
    if (!profile || user?.protected === true)
      throw new TypeError("Public X profile unavailable");
    const data = await readNativeStatistics(
      context,
      `https://api.x.com/2/users/${profile.id}/tweets`,
      [
        query("max_results", "100"),
        query("exclude", "retweets,replies"),
        query("start_time", publishedFrom),
        query(
          "post.fields",
          "created_at,public_metrics,note_post,attachments,entities",
        ),
        query(
          "expansions",
          "attachments.media_keys,author_id,referenced_posts",
        ),
        query(
          "media.fields",
          "type,url,preview_image_url,variants,public_metrics",
        ),
      ],
    );
    if (!Array.isArray(data.data) && record(data.meta)?.result_count === 0)
      data.data = [];
    const posts = parseXAccountPosts(data, profile.id).map((post) =>
      socialAccountPostSchema.parse({
        ...post,
        id: randomUUID(),
        connectionId: account.id,
        provider: "x",
        fetchedAt: now,
        additionalMetrics: post.additionalMetrics.filter(
          (metric) => metric.key === "quote_count",
        ),
      }),
    );
    const result = buildSocialPerformance({
      accounts: [
        socialAccountStatisticsAccountSchema.parse({
          ...account,
          externalHandle: profile.username,
          displayName: profile.name,
          avatarUrl: profile.avatarUrl,
          postCount: posts.length,
          statistics: null,
        }),
      ],
      posts,
      snapshots: [],
      query: { publishedFrom, publishedUntil: now.toISOString(), limit: 100 },
      now,
    });
    const mean = result.summary.current.metrics.impressions.mean;
    return socialPerformanceBenchmarkResponseSchema.parse({
      profile: {
        id: profile.id,
        name: profile.name,
        username: profile.username,
        avatarUrl: profile.avatarUrl,
        followersCount: profile.followersCount,
      },
      observedAt: now,
      summary: result.summary.current,
      posts: result.posts,
      meanImpressionsToFollowers:
        mean !== null &&
        profile.followersCount !== null &&
        profile.followersCount > 0
          ? mean / profile.followersCount
          : null,
      coverage: `Public lifetime counters for up to 100 original and quote posts published in the last 90 days.${nextCursor(data) ? " More posts exist beyond this sample." : ""} Impressions include repeat views. Private clicks, follower attribution and historical growth are unavailable for another account.`,
    });
  } catch {
    throw serviceUnavailable(
      "X public benchmark is unavailable. Confirm the handle is public, then check connection permissions, API access and rate limits.",
    );
  }
}

/** Recent public discovery is an explicitly bounded sample, not a global ranking or archival backfill. */
export async function readSocialPerformanceDiscovery(
  input: Scope & Partial<z.infer<typeof socialPerformanceDiscoveryQuerySchema>>,
) {
  const request = socialPerformanceDiscoveryQuerySchema.parse(input);
  const now = new Date();
  const cutoff = now.getTime() - 7 * 86_400_000;
  // Leave an hour inside retention so bounded cursor reads can retain the resolved window.
  const publishedFrom = request.publishedFrom
    ? new Date(request.publishedFrom).toISOString()
    : new Date(cutoff + 3_600_000).toISOString();
  const publishedUntil = request.publishedUntil
    ? new Date(request.publishedUntil).toISOString()
    : now.toISOString();
  if (request.cursor && new Date(publishedFrom).getTime() <= cutoff)
    throw badRequest(
      "This X discovery cursor range has expired. Start a new search within the last seven days.",
    );
  if (
    new Date(publishedFrom).getTime() <= cutoff ||
    new Date(publishedUntil) > now ||
    new Date(publishedFrom) >= new Date(publishedUntil)
  )
    throw badRequest(
      "X recent discovery dates must be within the last seven days and end after the start",
    );
  const { context } = await scopedXConnection(input);
  const formatOperator = {
    any: "",
    text: "-has:media -has:links",
    image: "has:images",
    carousel: "has:images",
    video: "has:videos",
    link: "has:links",
  }[request.format];
  const searchQuery = [
    ...(request.topic ? [`"${request.topic}"`] : []),
    ...(request.username ? [`from:${request.username}`] : []),
    ...(request.language ? [`lang:${request.language}`] : []),
    formatOperator,
    "-is:retweet",
    "-is:reply",
  ]
    .filter(Boolean)
    .join(" ");
  const parameters = [
    query("query", searchQuery),
    query("max_results", String(request.limit)),
    query("start_time", publishedFrom),
    query("end_time", publishedUntil),
    query("sort_order", "recency"),
    query(
      "post.fields",
      "created_at,public_metrics,note_post,attachments,entities,lang",
    ),
    query(
      "expansions",
      "attachments.media_keys,author_id,in_reply_to_user_id,referenced_posts",
    ),
    query("media.fields", "type,url,preview_image_url,variants,public_metrics"),
    userFields,
    ...(request.cursor ? [query("next_token", request.cursor)] : []),
  ];
  try {
    const data = await readNativeStatistics(
      context,
      "https://api.x.com/2/tweets/search/recent",
      parameters,
    );
    const rows = objects(data.data);
    if (
      (!Array.isArray(data.data) && record(data.meta)?.result_count !== 0) ||
      rows.length > request.limit
    )
      throw new TypeError("Invalid X discovery response");
    const evidence = rows
      .filter(
        (item, index, values) =>
          values.findIndex((value) => value.id === item.id) === index,
      )
      .map((item) => publicPostEvidence(item, data, input.connectionId, now))
      .filter((value) => value !== null);
    let missingCounterPostCount = 0;
    const posts = evidence.filter((value) => {
      const datesMatch =
        value.post.publishedAt !== null &&
        value.post.publishedAt >= publishedFrom &&
        value.post.publishedAt <= publishedUntil;
      if (
        !datesMatch ||
        value.post.postKind === "reply" ||
        value.post.postKind === "repost"
      )
        return false;
      if (request.format !== "any" && value.post.contentType !== request.format)
        return false;
      const checks = [
        {
          threshold: request.minLikes,
          count: value.post.metrics.likes,
          maximum: false,
        },
        {
          threshold: request.minComments,
          count: value.post.metrics.comments,
          maximum: false,
        },
        {
          threshold: request.minShares,
          count: value.post.metrics.shares,
          maximum: false,
        },
        {
          threshold: request.minImpressions,
          count: value.post.metrics.impressions,
          maximum: false,
        },
        {
          threshold: request.minFollowers,
          count: value.author?.followersCount ?? null,
          maximum: false,
        },
        {
          threshold: request.maxFollowers,
          count: value.author?.followersCount ?? null,
          maximum: true,
        },
      ].filter((check) => check.threshold !== undefined);
      if (checks.some((check) => check.count === null)) {
        missingCounterPostCount++;
        return false;
      }
      return checks.every(
        (check) =>
          check.threshold !== undefined &&
          check.count !== null &&
          (check.maximum
            ? check.count <= check.threshold
            : check.count >= check.threshold),
      );
    });
    posts.sort((left, right) => {
      if (request.sort === "likes" || request.sort === "impressions") {
        const difference =
          (right.post.metrics[request.sort] ?? Number.NEGATIVE_INFINITY) -
          (left.post.metrics[request.sort] ?? Number.NEGATIVE_INFINITY);
        if (Number.isFinite(difference) && difference !== 0) return difference;
        if (
          right.post.metrics[request.sort] !== null &&
          left.post.metrics[request.sort] === null
        )
          return 1;
        if (
          left.post.metrics[request.sort] !== null &&
          right.post.metrics[request.sort] === null
        )
          return -1;
      }
      return (right.post.publishedAt ?? "").localeCompare(
        left.post.publishedAt ?? "",
      );
    });
    return socialPerformanceDiscoveryResponseSchema.parse({
      posts,
      nextCursor: nextCursor(data),
      observedAt: now,
      publishedFrom,
      publishedUntil,
      samplePostCount: rows.length,
      matchedPostCount: posts.length,
      missingCounterPostCount,
      coverage:
        "X recent search covers the last seven days. This page samples provider-visible public original and quote posts matching the topic phrase, handle, language and media operators. Follower-size and metric thresholds and ranking apply only within this fetched page. Missing required counters are excluded, rather than treated as zero. Public lifetime impressions include repeat views; no private click metrics are exposed. This is not an exhaustive global ranking or full archive.",
    });
  } catch {
    throw serviceUnavailable(
      "X recent discovery is unavailable. Check connection scopes, search API access and rate limits, then try again.",
    );
  }
}
