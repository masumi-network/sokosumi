/**
 * Real-Postgres proof that a tester's double click grants Tester credits
 * once (ADR 0068).
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/cmo-tester-credits.postgres.test.ts
 *
 * The grant writes Cuso's row in a Serializable transaction before it checks
 * what pays for him: the second click waits for the first, fails on the row
 * and runs again, then sees the credits and grants nothing. Fixtures are
 * committed and deleted after. On PGlite (one backend) the two take turns.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPrismaClient } from "@sokosumi/database/client";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantCmoTesterCredits } from "./cmo-billing.service";

/** The data migration that retypes the credits earlier hires were granted. */
const starterToTesterSql = readFileSync(
  new URL(
    "../../../../packages/database/prisma/migrations/20261113210735_starter_credits_become_tester_credits/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;

const ORGANIZATION = `org-${randomUUID()}`;
const WORKSPACE = randomUUID();
/** 10^10 ledger units are one credit. */
const CREDIT = 10_000_000_000n;

function database() {
  if (!db) throw new Error("Missing integration database");
  return db;
}

async function hiredCuso(): Promise<string> {
  const projectId = randomUUID();
  await database()
    .$executeRaw`INSERT INTO "project" ("id", "createdAt", "updatedAt", "workspaceId", "name") VALUES (${projectId}::uuid, NOW(), NOW(), ${WORKSPACE}::uuid, 'Cuso project')`;
  await database().sokoBot.create({
    data: {
      workspaceId: WORKSPACE,
      projectId,
      userId: null,
      versionId: CMO_SOKO_BOT_VERSION_IDS[0],
      name: "Cuso",
    },
  });
  return projectId;
}

describe.skipIf(!db)("Tester credits against PostgreSQL", () => {
  beforeAll(async () => {
    if (!db) return;
    await db.$executeRaw`INSERT INTO "organization" ("id", "name", "slug", "createdAt") VALUES (${ORGANIZATION}, 'Tester Org', ${ORGANIZATION}, NOW())`;
    await db.$executeRaw`INSERT INTO "workspace" ("id", "createdAt", "updatedAt", "userId", "organizationId") VALUES (${WORKSPACE}::uuid, NOW(), NOW(), NULL, ${ORGANIZATION})`;
  });

  afterAll(async () => {
    if (!db) return;
    // Buckets and consumptions go with their transactions.
    await db.transaction.deleteMany({
      where: { organizationId: ORGANIZATION },
    });
    await db.sokoBot.deleteMany({ where: { workspaceId: WORKSPACE } });
    await db.$executeRaw`DELETE FROM "project" WHERE "workspaceId" = ${WORKSPACE}::uuid`;
    await db.$executeRaw`DELETE FROM "workspace" WHERE "id" = ${WORKSPACE}::uuid`;
    await db.$executeRaw`DELETE FROM "organization" WHERE "id" = ${ORGANIZATION}`;
    await db.$disconnect();
  });

  it("grants once when the button is clicked twice at once", async () => {
    const projectId = await hiredCuso();
    const grant = () =>
      grantCmoTesterCredits({ projectId, organizationId: ORGANIZATION });

    const outcomes = await Promise.all([grant(), grant()]);

    expect(outcomes.sort()).toEqual(["granted", "paid"]);
    const buckets = await database().creditBucket.findMany({
      where: { projectId },
      select: { amount: true, referenceType: true, expiresAt: true },
    });
    expect(buckets).toEqual([
      {
        amount: 10_000n * CREDIT,
        referenceType: "CMO_TESTER_CREDITS",
        expiresAt: null,
      },
    ]);
  });

  describe("the credits earlier hires were granted", () => {
    /** A bucket as main's grants wrote it: FREE unless named otherwise. */
    async function bucket(input: {
      note: string;
      projectId?: string;
      referenceType?: "FREE" | "STRIPE_FREE";
    }) {
      const created = await database().transaction.create({
        data: {
          amount: 10_000n * CREDIT,
          organizationId: ORGANIZATION,
          sourceCreditBucket: {
            create: {
              amount: 10_000n * CREDIT,
              organizationId: ORGANIZATION,
              projectId: input.projectId ?? null,
              referenceId: `org:${ORGANIZATION}:free:${randomUUID()}`,
              referenceNote: input.note,
              referenceType: input.referenceType ?? "FREE",
            },
          },
        },
        select: { sourceCreditBucket: { select: { id: true } } },
      });
      const id = created.sourceCreditBucket?.id;
      if (!id) throw new Error("The grant created no bucket");
      return id;
    }

    async function read(id: string) {
      return await database().creditBucket.findUniqueOrThrow({
        where: { id },
        select: {
          referenceType: true,
          referenceId: true,
          referenceNote: true,
          amount: true,
          expiresAt: true,
          projectId: true,
        },
      });
    }

    it("are retyped to Tester credits, once, leaving every other field and every other bucket alone", async () => {
      const projectId = await hiredCuso();
      const ids = {
        project: await bucket({
          note: `CMO.xyz starter credits (project ${projectId})`,
          projectId,
        }),
        pool: await bucket({ note: "CMO.xyz starter credits (user-1)" }),
        admin: await bucket({ note: "Thanks for the feedback" }),
        otherType: await bucket({
          note: "CMO.xyz starter credits (project x)",
          referenceType: "STRIPE_FREE",
        }),
      };
      const before = Object.fromEntries(
        await Promise.all(
          Object.entries(ids).map(async ([key, id]) => [key, await read(id)]),
        ),
      );

      await database().$executeRawUnsafe(starterToTesterSql);
      await database().$executeRawUnsafe(starterToTesterSql);

      for (const key of ["project", "pool"] as const) {
        expect(await read(ids[key])).toEqual({
          ...before[key],
          referenceType: "CMO_TESTER_CREDITS",
        });
      }
      expect(await read(ids.admin)).toEqual(before.admin);
      expect(await read(ids.otherType)).toEqual(before.otherType);
    });
  });
});
