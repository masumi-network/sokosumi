import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { withAutomaticSeoStatistics } from "./project-seo-statistics-cache";
import type { SeoMutationHooks } from "./project-seo-store";
import { resolveProvider } from "./soko-bot-integrations.service";
import { syncLockService } from "./sync-lock.service";

const database = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(
    database?.startsWith("postgres") &&
      ["127.0.0.1", "localhost"].includes(new URL(database).hostname),
  );
const keys = new Set<string>();
const fixtures: ReturnType<typeof context>[] = [];
const organizations = new Set<string>();
function context() {
  return {
    actor: {
      owner: { kind: "audit" as const, id: randomUUID() },
      workspaceId: randomUUID(),
      userId: randomUUID(),
      organizationId: null,
    },
    input: {
      provider: "ga4" as const,
      propertyId: "properties/123",
      from: "2026-01-01",
      to: "2026-01-02",
      automatic: true,
    },
    integration: {
      provider: resolveProvider("google_analytics"),
      composioAccountId: randomUUID(),
      entityId: "statistics-lease-test",
      connectionRevision: "1",
    },
    pageUrls: ["https://example.test/a"],
    pageIds: [randomUUID()],
    keywords: [],
    hooks: {},
    readWorkspace: async () => "cached",
    activate: async () => "activated",
  };
}

describe.skipIf(!enabled)(
  "automatic SEO statistics leases on PostgreSQL",
  () => {
    afterAll(async () => {
      await prisma.lock.deleteMany({ where: { key: { in: [...keys] } } });
      await prisma.workspace.deleteMany({
        where: { id: { in: fixtures.map(({ actor }) => actor.workspaceId) } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [...organizations] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: fixtures.map(({ actor }) => actor.userId) } },
      });
      await prisma.$disconnect();
    });

    it("reactivates the reader's cached snapshot when another organization member has newer visible statistics", async () => {
      const fixture = context();
      const peer = context();
      fixtures.push(fixture, peer);
      const organizationId = randomUUID();
      organizations.add(organizationId);
      for (const userId of [fixture.actor.userId, peer.actor.userId]) {
        await prisma.user.create({
          data: {
            id: userId,
            name: "SEO shared cache fixture",
            email: `${userId}@example.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: "SEO shared cache fixture",
          slug: organizationId,
          workspace: { create: { id: fixture.actor.workspaceId } },
          members: {
            create: [fixture.actor.userId, peer.actor.userId].map((userId) => ({
              userId,
              seatAssignedAt: new Date(),
            })),
          },
        },
      });
      await prisma.seoAudit.create({
        data: {
          id: fixture.actor.owner.id,
          workspaceId: fixture.actor.workspaceId,
          createdById: fixture.actor.userId,
          name: "Shared statistics cache fixture",
        },
      });
      const actor = { ...fixture.actor, organizationId };
      let collections = 0;
      const request = {
        ...fixture,
        actor,
        collect: async (fingerprint: string) => {
          keys.add(`seo-statistics:${fingerprint}`);
          collections++;
          const at = new Date(Date.now() - 2_000);
          const payload = {
            provider: "ga4",
            propertyId: fixture.input.propertyId,
            pageUrls: fixture.pageUrls,
            channel: "all",
            from: fixture.input.from,
            to: fixture.input.to,
            timeZone: "UTC",
            observedAt: at.toISOString(),
            collectedAt: at.toISOString(),
            coverage: "partial",
            notes: [],
            metrics: [],
            collectionFingerprint: fingerprint,
          };
          await prisma.projectSeoObservation.create({
            data: {
              auditId: actor.owner.id,
              ownerId: actor.userId,
              visibility: "SHARED",
              kind: "metrics",
              source: "ga4",
              sourceKey: randomUUID(),
              artifactHash: fingerprint,
              payload,
              pageIds: fixture.pageIds,
              observedAt: at,
            },
          });
          await prisma.projectSeoObservation.create({
            data: {
              auditId: actor.owner.id,
              ownerId: peer.actor.userId,
              visibility: "SHARED",
              kind: "metrics",
              source: "ga4",
              sourceKey: randomUUID(),
              artifactHash: "b".repeat(64),
              payload: {
                ...payload,
                propertyId: "properties/456",
                collectionFingerprint: "b".repeat(64),
                observedAt: new Date(Date.now() - 1_000).toISOString(),
              },
              pageIds: fixture.pageIds,
              observedAt: new Date(Date.now() - 1_000),
            },
          });
          return "collected";
        },
      };
      await expect(withAutomaticSeoStatistics(request)).resolves.toBe(
        "collected",
      );
      await expect(withAutomaticSeoStatistics(request)).resolves.toBe(
        "activated",
      );
      expect(collections).toBe(1);
      await prisma.projectSeoObservation.updateMany({
        where: { auditId: actor.owner.id, ownerId: peer.actor.userId },
        data: { pageIds: [randomUUID()] },
      });
      await expect(withAutomaticSeoStatistics(request)).resolves.toBe("cached");
      expect(collections).toBe(1);
    });

    it("reuses only the persisted snapshot of the exact account revision", async () => {
      const fixture = context();
      fixtures.push(fixture);
      await prisma.user.create({
        data: {
          id: fixture.actor.userId,
          name: "SEO statistics cache fixture",
          email: `${fixture.actor.userId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          workspace: { create: { id: fixture.actor.workspaceId } },
        },
      });
      await prisma.seoAudit.create({
        data: {
          id: fixture.actor.owner.id,
          workspaceId: fixture.actor.workspaceId,
          createdById: fixture.actor.userId,
          name: "Statistics cache fixture",
        },
      });
      let collections = 0;
      const request = {
        ...fixture,
        collect: async (fingerprint: string, hooks: SeoMutationHooks) => {
          keys.add(`seo-statistics:${fingerprint}`);
          collections++;
          const at = new Date();
          const payload = {
            provider: "ga4",
            propertyId: fixture.input.propertyId,
            pageUrls: fixture.pageUrls,
            channel: "all",
            from: fixture.input.from,
            to: fixture.input.to,
            timeZone: "UTC",
            observedAt: at.toISOString(),
            coverage: "partial",
            notes: [],
            metrics: [],
            collectionFingerprint: fingerprint,
          };
          await prisma.$transaction(async (tx) => {
            await hooks.authorize?.(tx);
            await tx.projectSeoObservation.create({
              data: {
                auditId: fixture.actor.owner.id,
                ownerId: fixture.actor.userId,
                kind: "metrics",
                source: "ga4",
                sourceKey: randomUUID(),
                artifactHash: fingerprint,
                payload,
                pageIds: fixture.pageIds,
                observedAt: at,
              },
            });
          });
          return "collected";
        },
      };
      await expect(withAutomaticSeoStatistics(request)).resolves.toBe(
        "collected",
      );
      await expect(withAutomaticSeoStatistics(request)).resolves.toBe("cached");
      expect(collections).toBe(1);
      request.integration.connectionRevision = "2";
      await expect(withAutomaticSeoStatistics(request)).resolves.toBe(
        "collected",
      );
      expect(collections).toBe(2);
    });

    it("coalesces concurrent requests and releases the lease after commit", async () => {
      let enter!: () => void;
      let resume!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const resumed = new Promise<void>((resolve) => {
        resume = resolve;
      });
      let collections = 0;
      const request = {
        ...context(),
        collect: async (fingerprint: string, hooks: SeoMutationHooks) => {
          const key = `seo-statistics:${fingerprint}`;
          keys.add(key);
          collections++;
          enter();
          await resumed;
          if (typeof hooks.authorize === "function")
            await prisma.$transaction(hooks.authorize);
          return "collected";
        },
      };
      const first = withAutomaticSeoStatistics(request);
      await Promise.race([
        entered,
        first.then(() => {
          throw new Error("Collector did not start");
        }),
      ]);
      try {
        await expect(withAutomaticSeoStatistics(request)).rejects.toMatchObject(
          { status: 409 },
        );
        expect(collections).toBe(1);
      } finally {
        resume();
      }
      await expect(first).resolves.toBe("collected");
      expect(
        await prisma.lock.findUnique({ where: { key: [...keys].at(-1)! } }),
      ).toMatchObject({ isLocked: false });
    });

    it("rejects a collector after its lease expires and another owner takes over", async () => {
      let replacement:
        | Awaited<ReturnType<typeof syncLockService.acquireLock>>
        | undefined;
      try {
        await expect(
          withAutomaticSeoStatistics({
            ...context(),
            collect: async (fingerprint, hooks) => {
              const key = `seo-statistics:${fingerprint}`;
              keys.add(key);
              await prisma.lock.update({
                where: { key },
                data: {
                  lockedAt: new Date(
                    Date.now() - getEnv().LOCK_TIMEOUT - 1_000,
                  ),
                },
              });
              replacement = await syncLockService.acquireLock(key);
              if (hooks.authorize) await prisma.$transaction(hooks.authorize);
              return "must not commit";
            },
          }),
        ).rejects.toMatchObject({ status: 409 });
        expect(replacement).toBeDefined();
        expect(
          await prisma.lock.findUnique({ where: { key: replacement!.key } }),
        ).toMatchObject({ isLocked: true, lockedBy: replacement!.ownerToken });
      } finally {
        if (replacement)
          await syncLockService.releaseLock(
            replacement.key,
            replacement.ownerToken,
          );
      }
    });
  },
);
