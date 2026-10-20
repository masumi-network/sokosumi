import type { z } from "@hono/zod-openapi";
import type {
  Cell,
  ExportSheet,
} from "@/helpers/social-account-statistics-export";
import type { socialPerformanceAudienceResponseSchema } from "@/schemas/social-statistics-research.schema";

type AudiencePage = z.infer<typeof socialPerformanceAudienceResponseSchema>;
const METRICS = [
  "views",
  "impressions",
  "likes",
  "comments",
  "shares",
  "saves",
] as const;

/** Preserve loaded pages and their sample coverage; never imply a complete audience or deduplicate page evidence. */
export function socialStatisticsAudienceExportSheets({
  connectionId,
  accountName,
  pages,
  includeProfileDetails = false,
}: {
  connectionId: string;
  accountName: string;
  pages: AudiencePage[];
  includeProfileDetails?: boolean;
}): ExportSheet[] {
  const profileDetails = `Bios and locations are left out by default. ${
    includeProfileDetails
      ? "Included in Contacts by explicit includeProfileDetails opt-in."
      : "Set includeProfileDetails to true to include them in Contacts."
  }`;
  const provenance = [
    "platform",
    "account",
    "account_id",
    "page_index",
    "kind",
    "post_id",
    "observed_at",
    "sample_post_count",
    "page_contact_count",
    "oldest_post_at",
    "newest_post_at",
    "next_cursor",
    "coverage",
    "timezone",
    "source",
    "profile_details",
  ];
  const contacts: Cell[][] = [
    [
      "row_type",
      ...provenance,
      "name",
      "username",
      ...(includeProfileDetails ? ["description", "location"] : []),
      "followers_count",
      "interactions",
      "replies",
      "quotes",
      "mentions",
      "likes",
      "reposts",
    ],
  ];
  const coverage: Cell[][] = [[...provenance, "page_incoming_post_count"]];
  const incoming: Cell[][] = [
    [
      ...provenance,
      "incoming_post_id",
      "interaction_type",
      "author_name",
      "author_username",
      "published_at",
      "text",
      "url",
      "content_type",
      "post_kind",
      ...METRICS,
      "quote_count",
      "measured_at",
    ],
  ];
  pages.forEach((page, index) => {
    const metadata: Cell[] = [
      "x",
      accountName,
      connectionId,
      index + 1,
      page.kind,
      page.postId,
      page.observedAt,
      page.samplePostCount,
      page.contacts.length,
      page.oldestPostAt,
      page.newestPostAt,
      page.nextCursor,
      page.coverage,
      "UTC",
      "loaded_client_sample",
      profileDetails,
    ];
    coverage.push([...metadata, page.posts.length]);
    const rows = page.contacts.length ? page.contacts : [null];
    for (const contact of rows) {
      contacts.push([
        contact ? "contact" : "page_coverage",
        ...metadata,
        contact?.name ?? null,
        contact?.username ?? null,
        ...(includeProfileDetails
          ? [contact?.description ?? null, contact?.location ?? null]
          : []),
        contact?.followersCount ?? null,
        contact?.interactions ?? null,
        contact?.replies ?? null,
        contact?.quotes ?? null,
        contact?.mentions ?? null,
        contact?.likes ?? null,
        contact?.reposts ?? null,
      ]);
    }
    for (const evidence of page.posts) {
      incoming.push([
        ...metadata,
        evidence.post.externalId,
        evidence.interactionType,
        evidence.author?.name ?? null,
        evidence.author?.username ?? null,
        evidence.post.publishedAt,
        evidence.post.text,
        evidence.post.url,
        evidence.post.contentType,
        evidence.post.postKind,
        ...METRICS.map((key) => evidence.post.metrics[key]),
        evidence.post.additionalMetrics.find(
          (metric) => metric.key === "quote_count",
        )?.value ?? null,
        evidence.post.fetchedAt,
      ]);
    }
  });
  return [
    { name: "Contacts", rows: contacts },
    { name: "Coverage", rows: coverage },
    { name: "Incoming posts", rows: incoming },
    {
      name: "Definitions",
      rows: [
        ["field", "definition"],
        ["platform", "x"],
        ["account", accountName],
        ["account_id", connectionId],
        [
          "period",
          "oldest_post_at and newest_post_at bound only the sampled posts, not an exhaustive publication period. Null means no post period is available. Followers are a snapshot, not a history of when people followed.",
        ],
        ["timezone", "UTC; all timestamps are ISO 8601 UTC."],
        [
          "freshness",
          "observed_at is the submitted page fetch time; measured_at is the submitted post counter fetch time. Export does not refresh provider data.",
        ],
        [
          "coverage",
          "Loaded client samples only, not a complete audience or verified provider report. Each page retains its coverage, continuation cursor and counts. Repeated contacts and post evidence are not deduplicated across pages.",
        ],
        [
          "kind",
          "followers: follower; mentions: mention, reply or quote author; likers: selected post liker; reposters: selected post reposter. Interaction counts apply only to the submitted sample.",
        ],
        [
          "counts",
          "Public counters only. Null or blank means unavailable; numeric zero is measured zero. Post counters are lifetime totals at measured_at, not activity during the sampled period.",
        ],
        ["profile_details", profileDetails],
      ],
    },
  ];
}
