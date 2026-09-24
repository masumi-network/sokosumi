import { randomUUID } from "node:crypto";

import type { Prisma } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import {
  eraseWorkspaceCalendarData,
  lockCalendarErasureUser,
  lockWorkspaceCalendarForErasure,
} from "./calendar-erasure";
import { lockCalendarWorkspaceMembership } from "./calendar-membership-fence";
import { prepareTasksForUserDeletion } from "./user-deletion-tasks";

const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  databaseUrl?.startsWith("postgres");
const db = enabled && databaseUrl ? createPrismaClient(databaseUrl) : null;

afterAll(async () => {
  await db?.$disconnect();
});

// Run against a disposable database with all migrations applied. Roll back
// each fixture so both successful erasure and failures leave no test records.
describe.skipIf(!enabled)("Calendar erasure against PostgreSQL", () => {
  it("finishes organization erasure while an email dispatcher waits", async () => {
    if (!db) throw new Error("Missing integration database");
    const suffix = crypto.randomUUID();
    const user = await db.user.create({
      data: {
        name: "Concurrent erasure",
        email: `concurrent-erasure-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const organization = await db.organization.create({
      data: { name: "Concurrent erasure", slug: suffix },
    });
    const workspace = await db.workspace.create({
      data: { organizationId: organization.id },
    });
    const notificationsLocked = Promise.withResolvers<void>();
    const resumeErasure = Promise.withResolvers<void>();
    const operations: Promise<PromiseSettledResult<unknown>[]>[] = [];
    try {
      await db.member.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: "owner",
        },
      });
      const notification = await db.notification.create({
        data: {
          userId: user.id,
          workspaceId: workspace.id,
          organizationId: organization.id,
          kind: "SYSTEM",
          referenceId: suffix,
          eventId: suffix,
          messageKey: "test",
          messageParams: "{}",
        },
      });
      // Pause at the database boundary after erasure owns the notification.
      const erasureDb = db.$extends({
        query: {
          notification: {
            async updateMany({ args, query }) {
              const result = await query(args);
              notificationsLocked.resolve();
              await resumeErasure.promise;
              return result;
            },
          },
        },
      });
      const erasure = erasureDb.$transaction(
        async (tx) => {
          // The query-only extension preserves the transaction's model API.
          const erasureTx = tx as Prisma.TransactionClient;
          await lockCalendarErasureUser(erasureTx, user.id);
          await tx.$queryRaw`
            SELECT id FROM "organization"
            WHERE id = ${organization.id} FOR UPDATE
          `;
          await lockWorkspaceCalendarForErasure(erasureTx, workspace.id);
          await eraseWorkspaceCalendarData(erasureTx, workspace.id);
          await tx.organization.delete({ where: { id: organization.id } });
        },
        { timeout: 10_000 },
      );
      operations.push(Promise.allSettled([erasure]));
      await notificationsLocked.promise;

      const applicationName = `erasure-email-${suffix}`;
      const delivery = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT set_config('application_name', ${applicationName}, true)
          `;
          // The dispatcher's real member/advisory locks and final email write.
          await lockCalendarWorkspaceMembership(tx, workspace.id);
          return tx.notification.updateMany({
            where: { id: notification.id, isRead: false },
            data: {
              emailId: "concurrent-email",
              emailScheduledAt: new Date(Date.now() + 3_600_000),
            },
          });
        },
        { timeout: 10_000 },
      );
      operations.push(Promise.allSettled([delivery]));
      await expect
        .poll(
          async () => {
            const rows = await db.$queryRaw<Array<{ waiting: boolean }>>`
              SELECT EXISTS (
                SELECT 1 FROM pg_stat_activity
                WHERE application_name = ${applicationName}
                  AND wait_event_type = 'Lock'
              ) AS waiting
            `;
            return rows[0]?.waiting;
          },
          { timeout: 3_000 },
        )
        .toBe(true);
      resumeErasure.resolve();

      expect((await Promise.all(operations)).flat()).toEqual([
        { status: "fulfilled", value: undefined },
        { status: "fulfilled", value: { count: 0 } },
      ]);
      expect(
        await db.organization.count({ where: { id: organization.id } }),
      ).toBe(0);
    } finally {
      resumeErasure.resolve();
      await Promise.all(operations);
      await db.organization.deleteMany({ where: { id: organization.id } });
      await db.user.deleteMany({ where: { id: user.id } });
    }
  });

  it.each(["user", "organization"] as const)(
    "erases %s Calendar history and outbox without touching another workspace",
    async (parent) => {
      if (!db) throw new Error("Missing integration database");
      const rollback = new Error("Rollback fixture");
      await expect(
        db.$transaction(async (tx) => {
          const suffix = crypto.randomUUID();
          const user = await tx.user.create({
            data: {
              name: "Calendar erasure test",
              emailVerified: true,
              createdAt: new Date(),
              updatedAt: new Date(),
              email: `calendar-erasure-${suffix}@nmkr.io`,
            },
          });
          const organization = await tx.organization.create({
            data: { name: "Calendar erasure test", slug: suffix },
          });
          const workspace = await tx.workspace.create({
            data:
              parent === "user"
                ? { userId: user.id }
                : { organizationId: organization.id },
          });
          const otherWorkspace = await tx.workspace.create({
            data:
              parent === "user"
                ? { organizationId: organization.id }
                : { userId: user.id },
          });
          const project = await tx.project.create({
            data: { workspaceId: workspace.id, name: "Retained history" },
          });
          const task = await tx.task.create({
            data: {
              ownerId: user.id,
              creatorUserId: user.id,
              workspaceId: workspace.id,
              organizationId:
                parent === "organization" ? organization.id : null,
              projectId: project.id,
              name: "Scheduled task",
              runAt: new Date("2026-09-01T09:00:00Z"),
            },
          });
          const schedule = await tx.taskSchedule.create({
            data: {
              ownerId: user.id,
              creatorUserId: user.id,
              workspaceId: workspace.id,
              organizationId:
                parent === "organization" ? organization.id : null,
              projectId: project.id,
              name: "Scheduled task",
              expr: "0 9 * * *",
              timezone: "UTC",
              anchorAt: new Date("2026-09-01T09:00:00Z"),
              ruleEffectiveFrom: new Date("2026-09-01T09:00:00Z"),
              epochId: randomUUID(),
            },
          });
          await tx.taskScheduleRun.create({
            data: {
              scheduleId: schedule.id,
              epochId: schedule.epochId,
              originalScheduledAt: new Date("2026-09-01T09:00:00Z"),
              effectiveScheduledAt: new Date("2026-09-01T09:00:00Z"),
              state: "SKIPPED",
              sourceWorkspaceId: workspace.id,
              sourceType: "PROJECT",
              sourceProjectId: project.id,
              timezone: "UTC",
            },
          });
          await tx.projectEvent.create({
            data: {
              projectId: project.id,
              eventKey: suffix,
              kind: "CLOSE_REQUESTED",
            },
          });
          await tx.calendarInvalidationOutbox.createMany({
            data: [workspace.id, otherWorkspace.id].map((workspaceId) => ({
              workspaceId,
              dedupeKey: `${suffix}:${workspaceId}`,
              calendarRevision: 1,
              payload: { userId: user.id },
            })),
          });
          const otherOutboxCount = await tx.calendarInvalidationOutbox.count({
            where: { workspaceId: otherWorkspace.id },
          });

          expect(await lockCalendarErasureUser(tx, user.id)).toBe(true);
          expect(await lockWorkspaceCalendarForErasure(tx, workspace.id)).toBe(
            true,
          );
          await eraseWorkspaceCalendarData(tx, workspace.id);
          if (parent === "user") {
            await tx.user.delete({ where: { id: user.id } });
          } else {
            await tx.organization.delete({ where: { id: organization.id } });
          }

          expect(
            await tx.workspace.count({ where: { id: workspace.id } }),
          ).toBe(0);
          expect(await tx.project.count({ where: { id: project.id } })).toBe(0);
          expect(await tx.task.count({ where: { id: task.id } })).toBe(0);
          expect(
            await tx.taskScheduleRun.count({
              where: { sourceWorkspaceId: workspace.id },
            }),
          ).toBe(0);
          expect(
            await tx.projectEvent.count({ where: { projectId: project.id } }),
          ).toBe(0);
          expect(
            await tx.calendarInvalidationOutbox.count({
              where: { workspaceId: workspace.id },
            }),
          ).toBe(0);
          expect(
            await tx.calendarInvalidationOutbox.count({
              where: { workspaceId: otherWorkspace.id },
            }),
          ).toBe(otherOutboxCount);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    },
  );

  it("keeps account revocations pending until scheduled email cancellation completes", async () => {
    if (!db) throw new Error("Missing integration database");
    const suffix = crypto.randomUUID();
    const user = await db.user.create({
      data: {
        name: "Departing member",
        email: `departing-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const organization = await db.organization.create({
      data: { name: "Surviving organization", slug: suffix },
    });
    const workspace = await db.workspace.create({
      data: { organizationId: organization.id },
    });
    try {
      await db.member.create({
        data: { userId: user.id, organizationId: organization.id },
      });
      const payload = {
        kind: "calendar_access_revoked",
        userId: user.id,
        organizationId: organization.id,
        pendingNotificationEmails: [
          {
            id: suffix,
            emailId: "scheduled-email",
            emailScheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
        ],
      };
      const pending = await db.calendarInvalidationOutbox.create({
        data: {
          workspaceId: workspace.id,
          dedupeKey: `pending:${suffix}`,
          calendarRevision: 1,
          payload,
        },
      });
      const published = await db.calendarInvalidationOutbox.create({
        data: {
          workspaceId: workspace.id,
          dedupeKey: `published:${suffix}`,
          calendarRevision: 2,
          payload,
          publishedAt: new Date(),
        },
      });

      await prepareTasksForUserDeletion(user.id, db);

      expect(await db.user.count({ where: { id: user.id } })).toBe(0);
      expect(await db.workspace.count({ where: { id: workspace.id } })).toBe(1);
      expect(
        await db.calendarInvalidationOutbox.findUnique({
          where: { id: pending.id },
        }),
      ).toMatchObject({ payload, publishedAt: null });
      expect(
        await db.calendarInvalidationOutbox.findUnique({
          where: { id: published.id },
        }),
      ).toBeNull();
    } finally {
      await db.organization.deleteMany({ where: { id: organization.id } });
      await db.user.deleteMany({ where: { id: user.id } });
    }
  });

  it("clears pending and published outbox rows on a legacy workspace cascade", async () => {
    if (!db) throw new Error("Missing integration database");
    const rollback = new Error("Rollback fixture");
    await expect(
      db.$transaction(async (tx) => {
        const suffix = crypto.randomUUID();
        const user = await tx.user.create({
          data: {
            name: "Legacy erasure test",
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            email: `legacy-erasure-${suffix}@example.test`,
          },
        });
        const workspace = await tx.workspace.create({
          data: { userId: user.id },
        });
        await tx.project.create({
          data: { workspaceId: workspace.id, name: "Legacy cascade" },
        });
        await tx.calendarInvalidationOutbox.createMany({
          data: [null, new Date()].map((publishedAt, index) => ({
            workspaceId: workspace.id,
            dedupeKey: `${suffix}:${index}`,
            calendarRevision: index + 1,
            payload: { userId: user.id },
            publishedAt,
          })),
        });
        await tx.user.delete({ where: { id: user.id } });
        expect(
          await tx.calendarInvalidationOutbox.count({
            where: { workspaceId: workspace.id },
          }),
        ).toBe(0);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
