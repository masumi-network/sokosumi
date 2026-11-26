/** Fleet per day against a migrated, disposable PostgreSQL database.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-fleet-days.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";

import { sokoBotFleetDays } from "./soko-bot-usage.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("sokoBotFleetDays", () => {
  const organizationId = randomUUID();
  const evalOrganizationId = randomUUID();
  const ada = randomUUID();
  const ben = randomUUID();
  const lane = 9_000 + Math.floor(Math.random() * 1_000);
  let workspaceId: string;
  let evalWorkspaceId: string;
  let botId: string;
  let cmoBotId: string;
  let evalBotId: string;
  let evalCusoId: string;

  async function turn(data: {
    requestedByUserId: string | null;
    source?: "CHAT" | "SCHEDULE";
    chainDepth?: number;
    createdAt?: Date;
    costUsdMicros?: bigint;
    sokoBotId?: string;
    workspaceId?: string;
    clientTurnId?: string;
    parentTurnId?: string;
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
    cmoBotId = (
      await prisma.sokoBot.create({
        data: { workspaceId, versionId: CMO_SOKO_BOT_VERSION_ID },
      })
    ).id;

    await turn({ requestedByUserId: ada, costUsdMicros: 10_000n });
    await turn({ requestedByUserId: ada, costUsdMicros: 10_000n });
    await turn({ requestedByUserId: ben, costUsdMicros: 10_000n });
    // A bot asking a bot and a schedule cost money but are nobody's message.
    await turn({ requestedByUserId: ben, chainDepth: 1 });
    await turn({ requestedByUserId: ada, source: "SCHEDULE" });
    // A CMO.xyz bot counts only toward its own cost.
    await turn({
      requestedByUserId: ben,
      sokoBotId: cmoBotId,
      costUsdMicros: 100_000n,
    });
    await turn({
      requestedByUserId: ben,
      createdAt: new Date(Date.now() - 86_400_000),
      costUsdMicros: 5_000n,
    });

    // Eval lanes and lab runs are ours: they count only under evals.
    await prisma.organization.create({
      data: {
        id: evalOrganizationId,
        name: "Evals",
        slug: evalOrganizationId,
      },
    });
    evalWorkspaceId = (
      await prisma.workspace.create({
        data: { organizationId: evalOrganizationId },
      })
    ).id;
    evalBotId = (
      await prisma.sokoBot.create({
        data: { userId: ben, workspaceId: evalWorkspaceId },
      })
    ).id;
    evalCusoId = (
      await prisma.sokoBot.create({
        data: {
          workspaceId: evalWorkspaceId,
          versionId: CMO_SOKO_BOT_VERSION_ID,
        },
      })
    ).id;
    await prisma.evalLane.create({
      data: {
        lane,
        userId: ben,
        organizationId: evalOrganizationId,
        workspaceId: evalWorkspaceId,
        sokoBotId: evalBotId,
        cusoBotId: evalCusoId,
        world: {},
      },
    });
    await turn({
      requestedByUserId: ben,
      sokoBotId: evalBotId,
      workspaceId: evalWorkspaceId,
      costUsdMicros: 200_000n,
    });
    await turn({
      requestedByUserId: null,
      source: "SCHEDULE",
      sokoBotId: evalCusoId,
      workspaceId: evalWorkspaceId,
      costUsdMicros: 300_000n,
    });
    // A behaviour-lab turn on a customer's bot is ours too, and so is every
    // background run below it, though each has its own `background:` id.
    const labRoot = await turn({
      requestedByUserId: ada,
      clientTurnId: `lab:${randomUUID()}`,
      costUsdMicros: 400_000n,
    });
    const labChild = await turn({
      requestedByUserId: ada,
      clientTurnId: `background:${labRoot.id}:child`,
      parentTurnId: labRoot.id,
      costUsdMicros: 500_000n,
    });
    await turn({
      requestedByUserId: ada,
      source: "SCHEDULE",
      clientTurnId: `background:${labChild.id}:grandchild`,
      parentTurnId: labChild.id,
      costUsdMicros: 600_000n,
    });
    // A customer's own background run stays the customer's.
    const ownRoot = await turn({
      requestedByUserId: null,
      source: "SCHEDULE",
      costUsdMicros: 20_000n,
    });
    await turn({
      requestedByUserId: null,
      source: "SCHEDULE",
      clientTurnId: `background:${ownRoot.id}:child`,
      parentTurnId: ownRoot.id,
      costUsdMicros: 30_000n,
    });
  });

  afterAll(async () => {
    await prisma.evalLane.deleteMany({ where: { lane } });
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationId, evalOrganizationId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [ada, ben] } } });
    await prisma.$disconnect();
  });

  it("counts customers' people, turns and turn cost per UTC day, CMO.xyz and evals apart", async () => {
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
      // Five chat and schedule turns plus the customer's run and its child.
      turns: 7,
      totalTokens: 840,
    });
    // 0.035 + the customer's run 0.021 and its child 0.031.
    expect(today?.costUsd).toBeCloseTo(0.087);
    expect(today?.cmoCostUsd).toBeCloseTo(0.101);
    expect(yesterday?.cmoCostUsd).toBe(0);
    // Eval Soko Bot 0.201 + eval Cuso 0.301 + lab root 0.401, its child
    // 0.501 and grandchild 0.601.
    expect(today?.evalCostUsd).toBeCloseTo(2.005);
    expect(yesterday?.evalCostUsd).toBe(0);
  });
});
