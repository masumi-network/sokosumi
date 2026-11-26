/** Fleet move selection and lab trees against a migrated, disposable PostgreSQL database.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-fleet-move.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import { labRootedTurnIds } from "@/lib/soko-bot/lab-turns";

import { cmoSpend } from "./cmo-spend.service";
import { fleetBotsToMove } from "./soko-bot-control-plane.service";
import { getSokoBotQualityOverview } from "./soko-bot-quality.service";

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

  it("finds a lab turn's background runs on a customer's workspace, however old the root", async () => {
    // Forty days back: older than the quality window, and outside the
    // fleet-per-day test's window on a shared DB. A rating can land on it today.
    const at = new Date(Date.now() - 40 * 24 * 60 * 60_000);
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

    // Rated two days ago: inside the quality window, though the run and its
    // lab root are forty days old.
    const ratedAt = new Date(Date.now() - 2 * 24 * 60 * 60_000);
    await prisma.sokoBotTurn.update({
      where: { id: child.id },
      data: { ownerFeedback: -1, ownerFeedbackAt: ratedAt },
    });

    const lab = await labRootedTurnIds([
      child.id,
      own.id,
      ownChild.id,
      root.id,
    ]);

    expect(lab).toEqual(new Set([child.id, root.id]));

    // Codex's case end to end: the thumbs-down on the old lab run is not
    // customer feedback; the same-day one on the customer's own run is.
    // Ratings count on delivered updates nobody typed.
    await prisma.sokoBotTurn.updateMany({
      where: { id: { in: [child.id, ownChild.id] } },
      data: { status: "COMPLETED", source: "SCHEDULE", finalAnswer: "Done." },
    });
    await prisma.sokoBotTurn.update({
      where: { id: ownChild.id },
      data: { ownerFeedback: -1, ownerFeedbackAt: ratedAt },
    });
    const quality = await getSokoBotQualityOverview({
      sokoBotId: customerBotId,
    });
    const day = ratedAt.toISOString().slice(0, 10);
    expect(quality.daily.find((entry) => entry.date === day)).toMatchObject({
      thumbsDown: 1,
    });
  });

  it("leaves lab runs on a customer's Cuso out of its CMO spend", async () => {
    const at = new Date(Date.now() - 10 * 24 * 60 * 60_000);
    const projectId = (
      await prisma.project.create({
        data: { workspaceId: customerWorkspaceId, name: "Cuso's brand" },
      })
    ).id;
    const cusoId = (
      await prisma.sokoBot.create({
        data: {
          workspaceId: customerWorkspaceId,
          projectId,
          createdByUserId: userId,
          versionId: CMO_SOKO_BOT_VERSION_ID,
        },
      })
    ).id;
    const turn = (data: {
      clientTurnId: string;
      costUsdMicros: bigint;
      parentTurnId?: string;
    }) =>
      prisma.sokoBotTurn.create({
        data: {
          sokoBotId: cusoId,
          workspaceId: customerWorkspaceId,
          // Outside the fleet-per-day test's window on a shared DB.
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
