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
import { createPrismaClient } from "@sokosumi/database/client";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantCmoTesterCredits } from "./cmo-billing.service";

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
});
