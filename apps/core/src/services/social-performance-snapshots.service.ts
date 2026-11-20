import type { Prisma } from "@sokosumi/database";

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
