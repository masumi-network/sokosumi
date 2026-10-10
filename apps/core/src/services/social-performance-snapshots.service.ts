import type { Prisma } from "@sokosumi/database";
import {
  type SocialPostEngagementInput,
  summarizeSocialPostEngagement,
} from "@/helpers/social-post-engagement";
import {
  socialAccountMetricSchema,
  socialAccountPostSchema,
} from "@/schemas/social-account-statistics.schema";
import { socialPostMetricsSchema } from "@/schemas/social-post-statistics.schema";

interface PostObservationStore {
  socialAccountPost: Pick<
    Prisma.TransactionClient["socialAccountPost"],
    "findMany"
  >;
}

function utcDate(value: Date): Date {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/** Capture account observations only. Post counters stay on SocialAccountPost. */
export async function recordSocialPerformanceSnapshot(
  tx: Prisma.TransactionClient,
  input: {
    connectionId: string;
    metrics: Prisma.InputJsonValue | null;
    fetchedAt: Date;
    profileFetchedAt: Date | null;
  },
) {
  const date = utcDate(input.fetchedAt);
  await tx.socialPerformanceSnapshot.upsert({
    where: { connectionId_date: { connectionId: input.connectionId, date } },
    create: {
      connectionId: input.connectionId,
      date,
      metrics: input.metrics ?? [],
      fetchedAt: input.fetchedAt,
      profileFetchedAt: input.profileFetchedAt,
    },
    update: {
      ...(input.metrics === null
        ? {}
        : { metrics: input.metrics, profileFetchedAt: input.profileFetchedAt }),
      fetchedAt: input.fetchedAt,
    },
  });
}

/** Insights read every cached post for the connection, not only that UTC day. */
export async function listSocialPerformancePostObservations(
  db: PostObservationStore,
  input: { connectionId: string; fetchedAt: Date },
) {
  const rows = await db.socialAccountPost.findMany({
    where: {
      connectionId: input.connectionId,
    },
    include: { connection: { select: { provider: true } } },
    orderBy: [{ fetchedAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) =>
    socialAccountPostSchema.parse({
      ...row,
      provider: row.connection.provider,
    }),
  );
}

export async function readSocialPerformancePostInsights(
  db: PostObservationStore,
  input: { connectionId: string; fetchedAt: Date },
) {
  const posts = await listSocialPerformancePostObservations(db, input);
  const observed: SocialPostEngagementInput[] = posts.map((post) => ({
    provider: post.provider,
    metrics: socialPostMetricsSchema.parse(post.metrics),
    additionalMetrics: socialAccountMetricSchema
      .array()
      .parse(post.additionalMetrics),
  }));
  return {
    posts,
    engagement: summarizeSocialPostEngagement(observed),
  };
}
