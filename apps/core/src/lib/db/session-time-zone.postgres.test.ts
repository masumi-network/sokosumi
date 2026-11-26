import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { afterAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";
import { chunkExtractedText } from "@/lib/files/extraction";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountTaskSummary from "@/routes/v1/tasks/summary/get";
import { calendarInvalidationOutboxService } from "@/services/calendar-invalidation-outbox.service";
import { breakDownContacts } from "@/services/contact-breakdown.service";
import {
  enrichCompanies,
  listCompanies,
} from "@/services/contact-companies.service";
import { refreshContactFamiliarity } from "@/services/contact-scores.service";
import { writeVersionChunks } from "@/services/file-index.service";
import { withFixtureSchemas } from "@/test/split-layout";

const session = vi.hoisted(() => ({
  tx: undefined as Prisma.TransactionClient | undefined,
}));
vi.mock("@/lib/db/prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/prisma")>();
  return {
    ...actual,
    default: new Proxy(actual.default, {
      get(target, key) {
        const client = session.tx ?? target;
        return Reflect.get(client, key, client);
      },
    }),
  };
});
vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const minute = 60_000;
const day = 24 * 60 * minute;

describe.runIf(enabled).each(["UTC", "Europe/Berlin", "America/New_York"])(
  "SQL dates in %s",
  (zone) => {
    afterAll(() => prisma.$disconnect());

    async function inSession(
      run: (tx: Prisma.TransactionClient, now: Date) => Promise<void>,
    ) {
      const rollback = Symbol("rollback fixtures");
      await withFixtureSchemas(async (tx) => {
        // set_config(..., true) is SET LOCAL with a bind parameter.
        await tx.$queryRaw`SELECT set_config('TimeZone', ${zone}, true)`;
        const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`
          SELECT now() AT TIME ZONE 'UTC' AS now
        `;
        session.tx = tx;
        try {
          await run(tx, now);
        } finally {
          session.tx = undefined;
        }
        throw rollback;
      }).catch((error: unknown) => {
        if (error !== rollback) throw error;
      });
    }

    async function owner(tx: Prisma.TransactionClient, now: Date) {
      const userId = randomUUID();
      await tx.user.create({
        data: {
          id: userId,
          name: "SQL dates owner",
          email: `${userId}@example.test`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      });
      const { id: workspaceId } = await tx.workspace.create({
        data: { userId },
      });
      return { workspaceId, userId, sokoBotId: null };
    }

    it("keeps an open task's worked time in the UTC reporting window", async () => {
      await inSession(async (tx, now) => {
        const { workspaceId, userId } = await owner(tx, now);
        const { id: taskId } = await tx.task.create({
          data: {
            name: "Open task",
            status: "RUNNING",
            workspaceId,
            ownerId: userId,
          },
        });
        await tx.taskEvent.create({
          data: {
            taskId,
            status: "RUNNING",
            createdAt: new Date(+now - 60 * minute),
          },
        });

        const app = new OpenAPIHonoWithAuth();
        app.use("*", async (c, next) => {
          c.set("requestId", randomUUID());
          c.set("isAuthenticated", true);
          c.set("authContext", {
            actor: "user",
            userId,
            organizationId: null,
            role: "user",
          });
          c.set("workspaceContext", {
            workspaceId,
            userId,
            organizationId: null,
          });
          await next();
        });
        mountTaskSummary(app);
        const response = await app.request("/summary");
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          data: { workedMinutes: 60 },
        });
      });
    });

    it("prunes only published Calendar rows past the UTC retention cutoff", async () => {
      await inSession(async (tx, now) => {
        const workspaceId = randomUUID();
        const cutoff = +now - 7 * day;
        await tx.calendarInvalidationOutbox.createMany({
          data: [30, -30, null].map((offset) => ({
            workspaceId,
            dedupeKey: randomUUID(),
            calendarRevision: 1,
            payload: {},
            publishedAt:
              offset === null ? null : new Date(cutoff + offset * minute),
          })),
        });
        await calendarInvalidationOutboxService.syncInvalidations({
          shouldContinue: () => false,
        });
        const rows = await tx.calendarInvalidationOutbox.findMany({
          where: { workspaceId },
          select: { publishedAt: true },
        });
        expect(rows).toHaveLength(2);
        expect(rows).toEqual(
          expect.arrayContaining([
            { publishedAt: null },
            { publishedAt: new Date(cutoff + 30 * minute) },
          ]),
        );
      });
    });

    it("categorizes contacts on either side of the UTC recency boundary", async () => {
      await inSession(async (tx, now) => {
        const actor = await owner(tx, now);
        await tx.contact.createMany({
          data: [30, -30].map((offset) => ({
            workspaceId: actor.workspaceId,
            name: `Contact ${offset}`,
            lastContactAt: new Date(+now - 30 * day + offset * minute),
          })),
        });
        const { groups } = await breakDownContacts(actor, {
          filter: {},
          by: "lastContact",
        });
        expect(groups).toMatchObject([
          { key: "30d", count: 1 },
          { key: "90d", count: 1 },
        ]);
      });
    });

    it("stamps refreshed and reset contact scores in UTC", async () => {
      await inSession(async (tx, now) => {
        const { workspaceId, userId } = await owner(tx, now);
        const reset = await tx.contact.create({
          data: { workspaceId, name: "Reset" },
        });
        const scored = await tx.contact.create({
          data: { workspaceId, name: "Scored" },
        });
        await tx.contactScore.createMany({
          data: [
            { workspaceId, userId, contactId: reset.id, familiarity: 80 },
            { workspaceId, userId, contactId: scored.id, familiarity: 0 },
          ],
        });
        await tx.contactInteraction.create({
          data: {
            workspaceId,
            userId,
            contactId: scored.id,
            occurredAt: now,
            channel: "EMAIL",
            summary: "Met",
          },
        });
        await refreshContactFamiliarity(tx, { workspaceId });
        const scores = await tx.contactScore.findMany({
          where: { workspaceId },
        });
        expect(scores).toHaveLength(2);
        expect(scores.find((row) => row.contactId === reset.id)).toMatchObject({
          familiarity: 0,
        });
        expect(
          scores.find((row) => row.contactId === scored.id)?.familiarity,
        ).toBeGreaterThan(0);
        for (const score of scores) {
          expect.soft(Math.abs(+score.updatedAt - +now)).toBeLessThanOrEqual(1);
        }
      });
    });

    it("stamps inactive companies and completed lookups in UTC", async () => {
      await inSession(async (tx, now) => {
        const actor = await owner(tx, now);
        const { workspaceId } = actor;
        const orphan = await tx.contactCompany.create({
          data: { workspaceId, key: "n:orphan", name: "Orphan" },
        });
        await tx.contact.create({
          data: {
            workspaceId,
            name: "Person",
            organization: "Active",
            channels: {
              create: {
                workspaceId,
                type: "EMAIL",
                value: "person@active.example",
              },
            },
          },
        });
        await listCompanies(actor, { limit: 10 });
        const result = await enrichCompanies(workspaceId, {
          limit: 1,
          usd: 1,
          deps: {
            fetchPage: async () => "<p>Active Company</p>",
            generate: async () => ({
              text: '{"description":"Active company"}',
              costUsd: 0,
            }),
          },
        });
        expect(result.filled).toBe(1);
        const inactive = await tx.contactCompany.findUniqueOrThrow({
          where: { id: orphan.id },
        });
        const enriched = await tx.contactCompany.findFirstOrThrow({
          where: { workspaceId, enrichedAt: { not: null } },
        });
        for (const stamp of [
          inactive.inactiveSince,
          enriched.enrichedAt,
          enriched.updatedAt,
        ]) {
          expect(stamp).toBeInstanceOf(Date);
          expect.soft(Math.abs(Number(stamp) - +now)).toBeLessThanOrEqual(1);
        }
      });
    });

    it("stamps new file chunks in UTC", async () => {
      await inSession(async (tx, now) => {
        const { workspaceId, userId } = await owner(tx, now);
        const source = {
          workspaceId,
          sourceKind: "DRIVE_UPLOAD",
          sourceScope: "USER",
        } as const;
        const scope = await tx.fileEvidenceScope.create({
          data: { ...source, sourceId: userId, actorKinds: ["interactive"] },
        });
        const resource = await tx.fileResource.create({
          data: {
            ...source,
            sourceId: `${userId}/notes`,
            displayName: "Notes",
            normalizedName: "notes",
          },
        });
        const version = await tx.fileVersion.create({
          data: { resourceId: resource.id, revision: 1, objectKey: "notes" },
        });
        await writeVersionChunks({
          versionId: version.id,
          evidenceScopeId: scope.id,
          scopeVersion: 1,
          chunks: chunkExtractedText("Notes for the reader"),
          client: tx,
        });
        const chunk = await tx.fileChunk.findFirstOrThrow({
          where: { versionId: version.id },
        });
        expect(Math.abs(+chunk.createdAt - +now)).toBeLessThanOrEqual(1);
      });
    });
  },
);
