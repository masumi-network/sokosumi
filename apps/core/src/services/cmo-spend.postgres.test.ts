/** CMO spend against a migrated, disposable PostgreSQL database.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/cmo-spend.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";

import { cmoSpend } from "./cmo-spend.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("cmoSpend", () => {
  const organizationId = randomUUID();
  const userId = randomUUID();
  // Ten days back: outside the fleet-per-day test's window on a shared DB.
  const at = new Date(Date.now() - 10 * 24 * 60 * 60_000);
  let workspaceId: string;
  let cusoId: string;

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: "Spend", slug: organizationId },
    });
    await prisma.user.create({
      data: {
        id: userId,
        name: "Ada",
        email: `${userId}@example.test`,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    workspaceId = (await prisma.workspace.create({ data: { organizationId } }))
      .id;
    const projectId = (
      await prisma.project.create({
        data: { workspaceId, name: "Cuso's brand" },
      })
    ).id;
    cusoId = (
      await prisma.sokoBot.create({
        data: {
          workspaceId,
          projectId,
          createdByUserId: userId,
          versionId: CMO_SOKO_BOT_VERSION_ID,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("leaves lab runs on a customer's Cuso out of its CMO spend", async () => {
    const turn = (data: {
      clientTurnId: string;
      costUsdMicros: bigint;
      parentTurnId?: string;
    }) =>
      prisma.sokoBotTurn.create({
        data: {
          sokoBotId: cusoId,
          workspaceId,
          createdAt: at,
          source: "EVENT",
          userMessage: "Write the month",
          capabilityNames: [],
          deadlineAt: new Date(Date.now() + 60_000),
          modelId: "openai/gpt-6-luna",
          overheadCostUsdMicros: 1_000n,
          ...data,
        },
      });
    await turn({ clientTurnId: randomUUID(), costUsdMicros: 100_000n });
    const labRoot = await turn({
      clientTurnId: `lab:${randomUUID()}`,
      costUsdMicros: 2_000_000n,
    });
    await turn({
      clientTurnId: `background:${labRoot.id}:child`,
      parentTurnId: labRoot.id,
      costUsdMicros: 3_000_000n,
    });

    const spend = await cmoSpend(new Date(at.getTime() - 60 * 60_000));
    const cuso = spend.find((bot) => bot.sokoBotId === cusoId);

    // Only the customer's own turn: 0.100 for the model + 0.001 overhead.
    expect(cuso).toMatchObject({ turns: 1, evalLane: false });
    expect(cuso?.totalUsd).toBeCloseTo(0.101);
  });
});
