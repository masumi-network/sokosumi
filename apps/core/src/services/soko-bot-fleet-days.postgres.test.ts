/** Fleet per day against a migrated, disposable PostgreSQL database.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-fleet-days.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";

import { sokoBotFleetDays } from "./soko-bot-usage.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("sokoBotFleetDays", () => {
  const organizationId = randomUUID();
  const ada = randomUUID();
  const ben = randomUUID();
  let workspaceId: string;
  let botId: string;

  async function turn(data: {
    requestedByUserId: string | null;
    source?: "CHAT" | "SCHEDULE";
    chainDepth?: number;
    createdAt?: Date;
    costUsdMicros?: bigint;
  }) {
    return prisma.sokoBotTurn.create({
      data: {
        sokoBotId: botId,
        workspaceId,
        source: "CHAT",
        clientTurnId: randomUUID(),
        userMessage: "hi",
        capabilityNames: [],
        deadlineAt: new Date(Date.now() + 60_000),
        usage: { inputTokens: 100, outputTokens: 20 },
        overheadCostUsdMicros: 1_000n,
        ...data,
      },
    });
  }

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: "Fleet", slug: organizationId },
    });
    for (const id of [ada, ben]) {
      await prisma.user.create({
        data: {
          id,
          name: id,
          email: `${id}@example.test`,
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    workspaceId = (await prisma.workspace.create({ data: { organizationId } }))
      .id;
    botId = (
      await prisma.sokoBot.create({ data: { userId: ada, workspaceId } })
    ).id;

    await turn({ requestedByUserId: ada, costUsdMicros: 10_000n });
    await turn({ requestedByUserId: ada, costUsdMicros: 10_000n });
    await turn({ requestedByUserId: ben, costUsdMicros: 10_000n });
    // A bot asking a bot and a schedule cost money but are nobody's message.
    await turn({ requestedByUserId: ben, chainDepth: 1 });
    await turn({ requestedByUserId: ada, source: "SCHEDULE" });
    await turn({
      requestedByUserId: ben,
      createdAt: new Date(Date.now() - 86_400_000),
      costUsdMicros: 5_000n,
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [ada, ben] } } });
    await prisma.$disconnect();
  });

  it("counts people who wrote to a bot and what every turn cost, per UTC day", async () => {
    const days = await sokoBotFleetDays(3);

    expect(days).toHaveLength(3);
    const [before, yesterday, today] = days;
    expect(before).toMatchObject({
      users: 0,
      messages: 0,
      turns: 0,
      costUsd: 0,
    });
    expect(yesterday).toMatchObject({ users: 1, messages: 1, turns: 1 });
    expect(yesterday?.costUsd).toBeCloseTo(0.006);
    expect(today).toMatchObject({
      day: new Date().toISOString().slice(0, 10),
      users: 2,
      messages: 3,
      turns: 5,
      totalTokens: 600,
    });
    expect(today?.costUsd).toBeCloseTo(0.035);
  });
});
