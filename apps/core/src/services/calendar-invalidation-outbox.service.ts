import type { Prisma } from "@sokosumi/database";
import { z } from "zod";
import { lockCalendarWorkspaceMembership } from "@/helpers/calendar-membership-fence";
import { cancelNotificationEmails } from "@/helpers/notification-email-dispatch";
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

const pendingNotificationEmailsSchema = z.array(
  z.object({
    id: z.string(),
    emailId: z.string(),
    emailScheduledAt: z.coerce.date(),
  }),
);

function splitEmailCancellationPayload(payload: Prisma.JsonValue) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return { publicPayload: payload, emails: [] };
  }
  const { pendingNotificationEmails, ...publicPayload } = payload;
  return {
    publicPayload,
    emails: pendingNotificationEmailsSchema.parse(
      pendingNotificationEmails ?? [],
    ),
  };
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
          // already committed; the advisory lock holds until we snapshot the
          // audience. Ably publish runs after commit so the interactive tx does
          // not hold a pool connection across the network call.
          const { emails } = splitEmailCancellationPayload(
            readyInvalidation.payload,
          );
          const publication = prisma
            .$transaction(async (tx) => {
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
                return null;
              }

              const invalidation =
                await tx.calendarInvalidationOutbox.findUnique({
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
                });
              if (
                !invalidation ||
                invalidation.attempts !== attempts ||
                invalidation.publishedAt !== null
              ) {
                return null;
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
                return null;
              }

              const userIds = workspace.userId
                ? [workspace.userId]
                : (workspace.organization?.members.map(
                    (member) => member.userId,
                  ) ?? []);
              const revoked = accessRevocation(invalidation.payload);
              return {
                userIds,
                workspaceId: invalidation.workspaceId,
                invalidation: {
                  id: invalidation.id,
                  workspaceId: invalidation.workspaceId,
                  projectId: invalidation.projectId,
                  calendarRevision: invalidation.calendarRevision,
                  payload: splitEmailCancellationPayload(invalidation.payload)
                    .publicPayload,
                },
                revocation:
                  revoked !== null && !userIds.includes(revoked.userId)
                    ? revoked
                    : null,
              };
            })
            .then(async (snapshot) => {
              if (!snapshot) {
                return false;
              }
              await Promise.all([
                publishCalendarInvalidationToUsers({
                  userIds: snapshot.userIds,
                  workspaceId: snapshot.workspaceId,
                  invalidation: snapshot.invalidation,
                }),
                ...(snapshot.revocation
                  ? [
                      publishCalendarAccessRevoked({
                        ...snapshot.revocation,
                        workspaceId: snapshot.workspaceId,
                      }),
                    ]
                  : []),
              ]);
              return true;
            });
          // Cancellation uses the email queue; never wait on it while holding
          // the membership fence, which senders acquire from inside that queue.
          const deliveries = await Promise.allSettled([
            publication,
            cancelNotificationEmails(emails, { retryOnFailure: true }),
          ]);
          const failure = deliveries.find(
            (delivery) => delivery.status === "rejected",
          );
          if (failure?.status === "rejected") throw failure.reason;
          const published =
            deliveries[0]?.status === "fulfilled" && deliveries[0].value;
          if (published) {
            const marked = await prisma.calendarInvalidationOutbox.updateMany({
              where: { id: readyInvalidation.id, attempts, publishedAt: null },
              data: { publishedAt: new Date(), lastError: null },
            });
            if (marked.count !== 1) continue;
          }
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
