import type { Prisma } from "@sokosumi/database";
import { lockCalendarWorkspaceMembership } from "@/helpers/calendar-membership-fence";
import {
  publishCalendarAccessRevoked,
  publishCalendarInvalidationToUsers,
} from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";

const INVALIDATION_BATCH_SIZE = 25;
const INVALIDATION_LEASE_MS = 60_000;
const INVALIDATION_RETRY_BASE_MS = 5_000;
const INVALIDATION_MAX_ERROR_LENGTH = 1_000;
const INVALIDATION_RETENTION_DAYS = 7;
const INVALIDATION_PRUNE_BATCH_SIZE = 1_000;

export interface CalendarInvalidationSyncOptions {
  maxBatches?: number;
  newestFirst?: boolean;
  revokedUserId?: string;
  shouldContinue: () => boolean;
  workspaceId?: string;
}

export interface CalendarInvalidationSyncResult {
  claimed: number;
  published: number;
  failed: number;
}

function retryDelayMs(attempts: number): number {
  return Math.min(INVALIDATION_RETRY_BASE_MS * 2 ** (attempts - 1), 300_000);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, INVALIDATION_MAX_ERROR_LENGTH);
}

function accessRevocation(payload: Prisma.JsonValue): {
  userId: string;
  organizationId: string;
} | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  return payload.kind === "calendar_access_revoked" &&
    typeof payload.userId === "string" &&
    typeof payload.organizationId === "string"
    ? { userId: payload.userId, organizationId: payload.organizationId }
    : null;
}

function affectedProjectIds(payload: Prisma.JsonValue): string[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    !Array.isArray(payload.projectIds)
  ) {
    return [];
  }

  return [
    ...new Set(
      payload.projectIds.filter(
        (projectId): projectId is string => typeof projectId === "string",
      ),
    ),
  ];
}

async function prunePublishedInvalidations(): Promise<void> {
  try {
    await prisma.$executeRaw`
      DELETE FROM "calendar_invalidation_outbox"
      WHERE id IN (
        SELECT id
        FROM "calendar_invalidation_outbox"
        WHERE "publishedAt" < NOW() - (${INVALIDATION_RETENTION_DAYS} * INTERVAL '1 day')
        ORDER BY "publishedAt" ASC, id ASC
        LIMIT ${INVALIDATION_PRUNE_BATCH_SIZE}
      )
    `;
  } catch (error) {
    console.error("Failed to prune Calendar invalidations", error);
  }
}

export const calendarInvalidationOutboxService = {
  async syncInvalidations(
    options: CalendarInvalidationSyncOptions,
  ): Promise<CalendarInvalidationSyncResult> {
    const result: CalendarInvalidationSyncResult = {
      claimed: 0,
      published: 0,
      failed: 0,
    };
    let batches = 0;
    while (
      options.shouldContinue() &&
      (options.maxBatches === undefined || batches < options.maxBatches)
    ) {
      const now = new Date();
      const candidates = await prisma.calendarInvalidationOutbox.findMany({
        where: {
          publishedAt: null,
          nextAttemptAt: { lte: now },
          ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
          ...(options.revokedUserId
            ? {
                AND: [
                  {
                    payload: {
                      path: ["kind"],
                      equals: "calendar_access_revoked",
                    },
                  },
                  {
                    payload: {
                      path: ["userId"],
                      equals: options.revokedUserId,
                    },
                  },
                ],
              }
            : {}),
        },
        orderBy: options.newestFirst
          ? [{ calendarRevision: "desc" }, { id: "desc" }]
          : [{ nextAttemptAt: "asc" }, { id: "asc" }],
        take: INVALIDATION_BATCH_SIZE,
        select: { id: true, attempts: true },
      });
      if (candidates.length === 0) {
        break;
      }
      batches += 1;

      for (const candidate of candidates) {
        if (!options.shouldContinue()) {
          break;
        }

        const claimedAt = new Date();
        const attempts = candidate.attempts + 1;
        const claimed = await prisma.calendarInvalidationOutbox.updateMany({
          where: {
            id: candidate.id,
            attempts: candidate.attempts,
            publishedAt: null,
            nextAttemptAt: { lte: claimedAt },
          },
          data: {
            attempts: { increment: 1 },
            nextAttemptAt: new Date(
              claimedAt.getTime() + INVALIDATION_LEASE_MS,
            ),
            lastError: null,
          },
        });
        if (claimed.count !== 1) {
          continue;
        }
        result.claimed += 1;

        const claimedInvalidation =
          await prisma.calendarInvalidationOutbox.findUnique({
            where: { id: candidate.id },
            select: { id: true, workspaceId: true },
          });
        if (!claimedInvalidation) {
          continue;
        }

        try {
          // Commit the durable revision before any irreversible publish. A
          // subscriber that refreshes immediately can therefore observe it.
          const readyInvalidation = await prisma.$transaction(async (tx) => {
            const invalidation = await tx.calendarInvalidationOutbox.findUnique(
              {
                where: { id: candidate.id },
                select: {
                  id: true,
                  workspaceId: true,
                  projectId: true,
                  calendarRevision: true,
                  payload: true,
                  attempts: true,
                  publishedAt: true,
                },
              },
            );
            if (
              !invalidation ||
              invalidation.attempts !== attempts ||
              invalidation.publishedAt !== null
            ) {
              return null;
            }

            const workspace = await tx.workspace.findUnique({
              where: { id: invalidation.workspaceId },
              select: { id: true },
            });
            if (!workspace) {
              await tx.calendarInvalidationOutbox.deleteMany({
                where: { id: invalidation.id, attempts },
              });
              return null;
            }

            const projectIds = affectedProjectIds(invalidation.payload);
            await tx.workspace.updateMany({
              where: {
                id: invalidation.workspaceId,
                calendarRevision: { lt: invalidation.calendarRevision },
              },
              data: { calendarRevision: invalidation.calendarRevision },
            });
            if (projectIds.length > 0) {
              await tx.project.updateMany({
                where: {
                  id: { in: projectIds },
                  workspaceId: invalidation.workspaceId,
                  calendarRevision: { lt: invalidation.calendarRevision },
                },
                data: { calendarRevision: invalidation.calendarRevision },
              });
            }
            return invalidation;
          });
          if (!readyInvalidation) {
            continue;
          }

          // A second transaction fences membership only. The revision above is
          // already committed, while the shared advisory lock guarantees that a
          // removal cannot commit before a fanout using its old membership.
          const published = await prisma.$transaction(async (tx) => {
            await lockCalendarWorkspaceMembership(
              tx,
              readyInvalidation.workspaceId,
            );

            const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM "calendar_invalidation_outbox"
            WHERE id = ${readyInvalidation.id}::UUID
              AND attempts = ${attempts}
              AND "publishedAt" IS NULL
            FOR UPDATE
          `;
            if (lockedRows.length !== 1) {
              return false;
            }

            const invalidation = await tx.calendarInvalidationOutbox.findUnique(
              {
                where: { id: readyInvalidation.id },
                select: {
                  id: true,
                  workspaceId: true,
                  projectId: true,
                  calendarRevision: true,
                  payload: true,
                  attempts: true,
                  publishedAt: true,
                },
              },
            );
            if (
              !invalidation ||
              invalidation.attempts !== attempts ||
              invalidation.publishedAt !== null
            ) {
              return false;
            }

            const workspace = await tx.workspace.findUnique({
              where: { id: invalidation.workspaceId },
              select: {
                userId: true,
                organization: {
                  select: {
                    members: { select: { userId: true } },
                  },
                },
              },
            });
            if (!workspace) {
              await tx.calendarInvalidationOutbox.deleteMany({
                where: { id: invalidation.id, attempts },
              });
              return false;
            }

            const userIds = workspace.userId
              ? [workspace.userId]
              : (workspace.organization?.members.map(
                  (member) => member.userId,
                ) ?? []);
            const revoked = accessRevocation(invalidation.payload);
            const shouldPublishRevocation =
              revoked !== null && !userIds.includes(revoked.userId);
            await Promise.all([
              publishCalendarInvalidationToUsers({
                userIds,
                workspaceId: invalidation.workspaceId,
                invalidation: {
                  id: invalidation.id,
                  workspaceId: invalidation.workspaceId,
                  projectId: invalidation.projectId,
                  calendarRevision: invalidation.calendarRevision,
                  payload: invalidation.payload,
                },
              }),
              ...(shouldPublishRevocation && revoked
                ? [
                    publishCalendarAccessRevoked({
                      ...revoked,
                      workspaceId: invalidation.workspaceId,
                    }),
                  ]
                : []),
            ]);
            const marked = await tx.calendarInvalidationOutbox.updateMany({
              where: {
                id: invalidation.id,
                attempts,
                publishedAt: null,
              },
              data: {
                publishedAt: new Date(),
                lastError: null,
              },
            });
            return marked.count === 1;
          });
          if (published) {
            result.published += 1;
          }
        } catch (error) {
          result.failed += 1;
          await prisma.calendarInvalidationOutbox.updateMany({
            where: {
              id: claimedInvalidation.id,
              attempts,
              publishedAt: null,
            },
            data: {
              nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)),
              lastError: errorMessage(error),
            },
          });
        }
      }

      if (candidates.length < INVALIDATION_BATCH_SIZE) {
        break;
      }
    }

    await prunePublishedInvalidations();

    return result;
  },
};
