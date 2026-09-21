import type { Prisma } from "@sokosumi/database";

async function lockCalendarMembershipAdvisory(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  const membershipLock = `calendar-members:${workspaceId}`;
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${membershipLock}::TEXT, 0)
    )
  `;
}

/** Serialize Calendar fanout and scoped notification delivery with membership removal. */
export async function lockCalendarWorkspaceMembership(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  // Member deletion owns the row before its BEFORE DELETE trigger takes the
  // advisory lock. Take compatible Member row locks first as well, otherwise
  // publisher and deletion can each wait on the other's lock.
  await tx.$queryRaw`
    SELECT "member".id
    FROM "member"
    JOIN "workspace"
      ON "workspace"."organizationId" = "member"."organizationId"
    WHERE "workspace".id = ${workspaceId}::UUID
    ORDER BY "member".id ASC
    FOR KEY SHARE OF "member"
  `;

  await lockCalendarMembershipAdvisory(tx, workspaceId);
}

/** Lock one host member before changing rows that carry its organization FK. */
export async function lockCalendarWorkspaceUserMembership(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT "member".id
    FROM "member"
    JOIN "workspace"
      ON "workspace"."organizationId" = "member"."organizationId"
    WHERE "workspace".id = ${workspaceId}::UUID
      AND "member"."userId" = ${userId}
    FOR KEY SHARE OF "member"
  `;

  await lockCalendarMembershipAdvisory(tx, workspaceId);
}

export async function hasCalendarWorkspaceAccess(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const workspace = await tx.workspace.findFirst({
    where: {
      id: workspaceId,
      OR: [{ userId }, { organization: { members: { some: { userId } } } }],
    },
    select: { id: true },
  });

  return workspace !== null;
}
