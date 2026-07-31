import * as Sentry from "@sentry/node";
import { type Prisma, RiskClassification } from "@sokosumi/database";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

import type { RegistryDiffEntry } from "./agent-sync.projection.js";

/**
 * Prefix stamped onto a duplicate Agent row's identifiers when it is parked,
 * matching migration 20260730152000. Parked rows are bookkeeping artifacts:
 * they must never be read as admin curation.
 */
export const PARKED_IDENTIFIER_PREFIX = "legacy-v2:";

/**
 * Moves user-owned relations from a duplicate Agent row onto the canonical
 * one before the duplicate is parked. Mirrors the consolidation in migration
 * 20260730152000: ratings keep the newest per user (the (userId, agentId)
 * unique constraint forbids duplicates), categories and any admin metadata
 * override follow the stable row, and job notifications are retargeted so
 * their deep links keep resolving.
 */
export async function consolidateDuplicateAgentRelations(
  tx: Prisma.TransactionClient,
  duplicateAgentId: string,
  canonicalAgentId: string,
): Promise<void> {
  const [duplicateRatings, canonicalRatings] = await Promise.all([
    tx.userAgentRating.findMany({
      where: { agentId: duplicateAgentId },
      select: { id: true, userId: true, updatedAt: true },
    }),
    tx.userAgentRating.findMany({
      where: { agentId: canonicalAgentId },
      select: { id: true, userId: true, updatedAt: true },
    }),
  ]);
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
 * Migration 20260730152000 does the same rewrite with plain conjuncts, and
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

interface CuratedTwinDefaults {
  categoryIds: string[];
  isShown: boolean;
  riskClassification: RiskClassification;
}

/**
 * Curation defaults for a newly discovered registry entry, inherited from an
 * existing row for the same agent under a DIFFERENT registry policy (the V1
 * twin of a seller who re-registered under V2). Admin decisions live on the
 * local row, not in the registry, so without this a V2 registration would
 * resurrect a suppressed agent and reset its risk rating.
 *
 * Suppression is inherited pessimistically: if ANY twin is hidden the new row
 * starts hidden. The admin metadata override is deliberately NOT moved — it
 * is unique per agent and still serves the twin.
 */
export async function resolveCuratedTwinDefaults(
  entry: RegistryDiffEntry,
): Promise<CuratedTwinDefaults> {
  const fallback: CuratedTwinDefaults = {
    categoryIds: [],
    isShown: getEnv().SHOW_AGENTS_BY_DEFAULT,
    riskClassification: RiskClassification.MINIMAL,
  };
  if (!entry.apiBaseUrl || !entry.name) {
    return fallback;
  }

  try {
    const twins = await prisma.agent.findMany({
      where: {
        name: entry.name,
        apiBaseUrl: entry.apiBaseUrl,
        blockchainIdentifier: { not: entry.agentIdentifier },
        // Parked duplicates keep their name and endpoint but are hidden and
        // INVALID as bookkeeping, not as an admin decision. Treating them as
        // curation twins would pin every future registration of that agent to
        // hidden forever — and since parking bumps updatedAt they would
        // usually also win the risk/category inheritance below.
        // The parked prefix alone identifies bookkeeping rows. Filtering on
        // INVALID as well would discard genuinely invalid twins that may
        // still carry the admin curation this lookup exists to preserve.
        NOT: {
          blockchainIdentifier: { startsWith: PARKED_IDENTIFIER_PREFIX },
        },
      },
      select: {
        isShown: true,
        riskClassification: true,
        updatedAt: true,
        categories: { select: { id: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (twins.length === 0) {
      return fallback;
    }

    const newest = twins[0];
    return {
      categoryIds: newest.categories.map((category) => category.id),
      isShown: twins.every((twin) => twin.isShown) && fallback.isShown,
      riskClassification: newest.riskClassification,
    };
  } catch (error) {
    // Curation lookup must never break ingestion; fail to the safe default.
    console.warn(
      `[sync/agents] Failed to resolve curated twin for ${entry.agentIdentifier}; using defaults:`,
      error,
    );
    return fallback;
  }
}
