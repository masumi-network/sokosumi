/** Fleet move selection and lab trees against a migrated, disposable PostgreSQL database.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-fleet-move.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import { labTurnIdsSince } from "@/lib/soko-bot/lab-turns";

import { fleetBotsToMove } from "./soko-bot-control-plane.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("fleet moves and lab trees", () => {
  const organizationId = randomUUID();
  const laneOrganizationId = randomUUID();
  const userId = randomUUID();
  const version = `move-test-${randomUUID().slice(0, 8)}`;
  const lane = 8_000 + Math.floor(Math.random() * 1_000);
  let customerWorkspaceId: string;
  let laneWorkspaceId: string;
  let customerBotId: string;
  let laneBotId: string;

  beforeAll(async () => {
    for (const id of [organizationId, laneOrganizationId]) {
      await prisma.organization.create({
        data: { id, name: "Move", slug: id },
      });
    }
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
    customerWorkspaceId = (
      await prisma.workspace.create({ data: { organizationId } })
    ).id;
    laneWorkspaceId = (
      await prisma.workspace.create({
        data: { organizationId: laneOrganizationId },
      })
    ).id;
    customerBotId = (
      await prisma.sokoBot.create({
        data: { userId, workspaceId: customerWorkspaceId, versionId: version },
      })
    ).id;
    laneBotId = (
      await prisma.sokoBot.create({
        data: { workspaceId: laneWorkspaceId, versionId: version },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.evalLane.deleteMany({ where: { lane } });
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationId, laneOrganizationId] } },
    });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("leaves a lane out of a move the moment the lane exists", async () => {
    const before = await fleetBotsToMove(version);
    expect(before.map((bot) => bot.id).sort()).toEqual(
      [customerBotId, laneBotId].sort(),
    );

    // No cache between the lane and the move: the very next move skips it.
    await prisma.evalLane.create({
      data: {
        lane,
        userId,
        organizationId: laneOrganizationId,
        workspaceId: laneWorkspaceId,
        sokoBotId: laneBotId,
        world: {},
      },
    });

    expect(await fleetBotsToMove(version)).toEqual([
      { id: customerBotId, versionId: version },
    ]);
  });

  it("finds a lab turn's background runs on a customer's workspace", async () => {
    // Ten days back, outside the fleet-per-day test's window on a shared DB.
    const at = new Date(Date.now() - 10 * 24 * 60 * 60_000);
    const turn = (data: { clientTurnId: string; parentTurnId?: string }) =>
      prisma.sokoBotTurn.create({
        data: {
          sokoBotId: customerBotId,
          workspaceId: customerWorkspaceId,
          source: "CHAT",
          userMessage: "hi",
          capabilityNames: [],
          createdAt: at,
          deadlineAt: new Date(Date.now() + 60_000),
          ...data,
        },
      });
    const root = await turn({ clientTurnId: `lab:${randomUUID()}` });
    const child = await turn({
      clientTurnId: `background:${root.id}:child`,
      parentTurnId: root.id,
    });
    const own = await turn({ clientTurnId: randomUUID() });
    const ownChild = await turn({
      clientTurnId: `background:${own.id}:child`,
      parentTurnId: own.id,
    });

    const lab = await labTurnIdsSince(new Date(at.getTime() - 60 * 60_000));

    expect(lab.has(root.id)).toBe(true);
    expect(lab.has(child.id)).toBe(true);
    expect(lab.has(own.id)).toBe(false);
    expect(lab.has(ownChild.id)).toBe(false);
  });
});
