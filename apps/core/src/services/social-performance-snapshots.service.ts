import type { Prisma } from "@sokosumi/database";
import { socialAccountMetricSchema } from "@/schemas/social-account-statistics.schema";
import { socialPostMetricsSchema } from "@/schemas/social-post-statistics.schema";

/** Capture observations, not historical event-time engagement inferred from today's counters. */
export async function recordSocialPerformanceSnapshot(
  tx: Prisma.TransactionClient,
  input: {
    connectionId: string;
    metrics: Prisma.InputJsonValue | null;
    fetchedAt: Date;
    profileFetchedAt: Date | null;
  },
) {
  const date = new Date(input.fetchedAt);
  date.setUTCHours(0, 0, 0, 0);
  const until = new Date(date.getTime() + 86_400_000);
  const rows = await tx.socialAccountPost.findMany({
    where: {
      connectionId: input.connectionId,
      fetchedAt: { gte: date, lt: until },
    },
    select: {
      externalId: true,
      metrics: true,
      additionalMetrics: true,
      fetchedAt: true,
    },
  });
  const postMetrics: Prisma.InputJsonValue = rows.map((row) => ({
    externalId: row.externalId,
    metrics: { ...socialPostMetricsSchema.parse(row.metrics) },
    additionalMetrics: socialAccountMetricSchema
      .array()
      .parse(row.additionalMetrics)
      .map((metric) => ({ ...metric })),
    fetchedAt: row.fetchedAt.toISOString(),
  }));
  await tx.socialPerformanceSnapshot.upsert({
    where: { connectionId_date: { connectionId: input.connectionId, date } },
    create: {
      connectionId: input.connectionId,
      date,
      metrics: input.metrics ?? [],
      postMetrics,
      fetchedAt: input.fetchedAt,
      profileFetchedAt: input.profileFetchedAt,
    },
    update: {
      ...(input.metrics === null
        ? {}
        : { metrics: input.metrics, profileFetchedAt: input.profileFetchedAt }),
      postMetrics,
      fetchedAt: input.fetchedAt,
    },
  });
}
