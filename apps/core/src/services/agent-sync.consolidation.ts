import * as Sentry from "@sentry/node";
import { type Prisma } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";

/**
 * Prefix stamped onto a duplicate Agent row's identifiers when it is parked,
 * matching migration 20260803152000. Parked rows are bookkeeping artifacts:
 * they must never be read as admin curation.
 */
export const PARKED_IDENTIFIER_PREFIX = "legacy-v2:";

/**
 * Moves user-owned relations from a duplicate Agent row onto the canonical
 * one before the duplicate is parked. Mirrors the consolidation in migration
 * 20260803152000: ratings keep the newest per user (the (userId, agentId)
 * unique constraint forbids duplicates), categories and any admin metadata
 * override follow the stable row. Notification retargeting runs separately
 * after this transaction completes.
 */
export async function consolidateDuplicateAgentRelations(
  tx: Prisma.TransactionClient,
  duplicateAgentId: string,
  canonicalAgentId: string,
): Promise<void> {
  const duplicateRatings = await tx.userAgentRating.findMany({
    where: { agentId: duplicateAgentId },
    select: { id: true, userId: true, updatedAt: true },
  });
  const canonicalRatings = await tx.userAgentRating.findMany({
    where: { agentId: canonicalAgentId },
    select: { id: true, userId: true, updatedAt: true },
  });
  const canonicalByUser = new Map(
    canonicalRatings.map((rating) => [rating.userId, rating]),
  );
  for (const rating of duplicateRatings) {
    const canonicalRating = canonicalByUser.get(rating.userId);
    if (!canonicalRating) {
      await tx.userAgentRating.update({
        where: { id: rating.id },
        data: { agentId: canonicalAgentId },
      });
      continue;
    }
    // The canonical row already holds this user's rating; keep the newer one.
    if (rating.updatedAt > canonicalRating.updatedAt) {
      await tx.userAgentRating.delete({ where: { id: canonicalRating.id } });
      await tx.userAgentRating.update({
        where: { id: rating.id },
        data: { agentId: canonicalAgentId },
      });
    } else {
      await tx.userAgentRating.delete({ where: { id: rating.id } });
    }
  }

  const duplicate = await tx.agent.findUnique({
    where: { id: duplicateAgentId },
    select: {
      categories: { select: { id: true } },
      metadataOverride: { select: { id: true } },
    },
  });
  if (duplicate?.categories.length) {
    await tx.agent.update({
      where: { id: canonicalAgentId },
      data: {
        categories: {
          connect: duplicate.categories.map((category) => ({
            id: category.id,
          })),
        },
      },
    });
  }
  if (duplicate?.metadataOverride) {
    const canonicalOverride = await tx.agentMetadataOverride.findUnique({
      where: { agentId: canonicalAgentId },
      select: { id: true },
    });
    // AgentMetadataOverride.agentId is unique: only move when free.
    if (!canonicalOverride) {
      await tx.agentMetadataOverride.update({
        where: { id: duplicate.metadataOverride.id },
        data: { agentId: canonicalAgentId },
      });
    }
  }
}

/**
 * Retargets job-notification deep links from a parked duplicate to the
 * canonical row. Runs OUTSIDE the park transaction on purpose: `metadata` is
 * an unindexed text column, so this is a sequential scan whose duration grows
 * with the notification table — inside the transaction it would eventually
 * exceed the timeout and roll back the park, wedging the sync cursor.
 * A failure here only leaves a stale deep link, so it is reported and
 * swallowed rather than retried into that wedge.
 *
 * The inner CASE (rather than a WHERE on pg_input_is_valid) keeps the jsonb
 * cast from ever being evaluated on malformed rows: PostgreSQL does not
 * guarantee evaluation order WITHIN one relation's filter list, and every
 * qual here is single-relation.
 *
 * Migration 20260803152000 does the same rewrite with plain conjuncts, and
 * that is correct there for the opposite reason: its cast sits in a
 * two-relation qual joining to the repair table, which the planner can never
 * push below the notification scan. Converting it to this subquery form would
 * turn the join into a cross product — one jsonb parse per (notification,
 * repair) pair — so the two files differ on purpose.
 */
export async function retargetDuplicateAgentNotifications(
  duplicateAgentId: string,
  canonicalAgentId: string,
): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE "notification"
      SET "metadata" = jsonb_set(
        "metadata"::jsonb,
        '{agentId}',
        to_jsonb(${canonicalAgentId}::text)
      )::text
      WHERE "id" IN (
        SELECT "id" FROM "notification"
        WHERE CASE
          WHEN "metadata" IS NULL THEN FALSE
          WHEN NOT pg_input_is_valid("metadata", 'jsonb') THEN FALSE
          ELSE "metadata"::jsonb ->> 'agentId' = ${duplicateAgentId}
        END
      )`;
  } catch (error) {
    console.warn(
      `[sync/agents] Failed to retarget notifications from ${duplicateAgentId} to ${canonicalAgentId}:`,
      error,
    );
    Sentry.captureException(error);
  }
}
