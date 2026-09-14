import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import {
  eraseWorkspaceCalendarData,
  lockCalendarErasureUser,
  lockWorkspaceCalendarForErasure,
} from "./calendar-erasure";
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
              metadata: "{broken",
            },
          });
          await tx.taskScheduleQuarantine.create({
            data: {
              taskId: task.id,
              reason: "INVALID_METADATA",
              details: "Invalid schedule",
              capturedStatus: "DRAFT",
            },
          });
          await tx.taskScheduleOccurrence.create({
            data: {
              seriesTaskId: task.id,
              legacyLinkId: suffix,
              effectiveScheduledAt: new Date("2026-09-01T09:00:00Z"),
              state: "SKIPPED",
              sourceWorkspaceId: workspace.id,
              sourceType: "PROJECT",
              sourceProjectId: project.id,
              sourceAccuracy: "INFERRED",
              timeAccuracy: "APPROXIMATE",
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
            await tx.taskScheduleOccurrence.count({
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
