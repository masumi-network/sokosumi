import { afterAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import {
  evalCoworkerRefusal,
  forgetEvalWorkspaces,
  globalCoworkersFor,
  isEvalWorkspace,
} from "@/lib/evals/eval-guard";
import { isNewsletterWorkspaceEnabled } from "@/lib/newsletter/feature";
import { createSokoBotSchedule } from "@/services/soko-bot-schedule.service";
import {
  ensureEvalLanes,
  pauseEvalLanes,
  prepareEvalLane,
  resetEvalLaneForSokoBot,
} from "./eval-lanes.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("eval lanes", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sets up a lane's world once and finds it again", async () => {
    const [lane] = await ensureEvalLanes(1);
    expect(lane).toBeDefined();
    if (!lane) return;
    const [again] = await ensureEvalLanes(1);
    expect(again).toEqual(lane);

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: lane.organizationId },
      include: { members: { include: { user: true } } },
    });
    expect(organization.slug).toBe("sokosumi-evals-1");
    expect(
      organization.members.map((member) => member.user.name).sort(),
    ).toEqual(["Alex Kim", "Hannah Weber", "Robin Keller"]);

    const bots = await prisma.sokoBot.findMany({
      where: { id: { in: [lane.sokoBotId, lane.cusoBotId] } },
      select: {
        id: true,
        userId: true,
        projectId: true,
        proactivePaused: true,
      },
    });
    expect(bots).toHaveLength(2);
    expect(bots.every((bot) => bot.proactivePaused)).toBe(true);
    expect(bots.find((bot) => bot.id === lane.cusoBotId)?.projectId).toBe(
      lane.cusoProjectId,
    );

    const connections = await prisma.projectSocialConnection.findMany({
      where: {
        projectId: {
          in: [lane.world.marketingProjectId, lane.world.outreachProjectId],
        },
      },
    });
    expect(connections.map((connection) => connection.provider).sort()).toEqual(
      ["linkedin", "x"],
    );
    expect(
      connections.every((connection) =>
        connection.composioConnectedAccountId.startsWith("eval:"),
      ),
    ).toBe(true);

    const room = await prisma.chatRoom.findUniqueOrThrow({
      where: { id: lane.world.roomId },
      include: {
        messages: { where: { deletedAt: null } },
        sokoBotMembers: true,
      },
    });
    expect(room.messages).toHaveLength(3);
    expect(room.sokoBotMembers.map((member) => member.sokoBotId)).toEqual([
      lane.sokoBotId,
    ]);
  });

  it("counts the lane's workspace as an eval workspace, and no other", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
    forgetEvalWorkspaces();
    expect(await isEvalWorkspace(lane.workspaceId)).toBe(true);
    expect(await isEvalWorkspace("00000000-0000-4000-8000-000000000000")).toBe(
      false,
    );
    expect(await globalCoworkersFor(lane.workspaceId)).toEqual([]);
    expect(
      await globalCoworkersFor("00000000-0000-4000-8000-000000000000"),
    ).toEqual([{ isWhitelisted: true }]);
    expect(await isNewsletterWorkspaceEnabled(lane.workspaceId)).toBe(true);
  });

  it("refuses a global Coworker in an eval workspace", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
    const vendor = await prisma.vendor.create({
      data: {
        name: "Eval test vendor",
        slug: `eval-test-vendor-${Date.now()}`,
      },
    });
    const coworker = await prisma.coworker.create({
      data: {
        name: "Global researcher",
        slug: `global-researcher-${Date.now()}`,
        vendorId: vendor.id,
        isWhitelisted: true,
        capabilities: ["tasks"],
      },
    });
    try {
      expect(
        await evalCoworkerRefusal(lane.workspaceId, {
          coworkerId: coworker.id,
        }),
      ).toMatch(/not available in this workspace/);
      expect(
        await evalCoworkerRefusal(lane.workspaceId, {
          coworkerIds: [coworker.id],
        }),
      ).toMatch(/not available/);
      expect(
        await evalCoworkerRefusal(lane.workspaceId, { memberId: "x" }),
      ).toBe(null);
    } finally {
      await prisma.coworker.delete({ where: { id: coworker.id } });
      await prisma.vendor.delete({ where: { id: vendor.id } });
    }
  });

  it("prepares the lane for a run and pauses it after", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
    await prepareEvalLane(lane, { sokoBot: "v33", cuso: "cmo-v1" });
    const cuso = await prisma.sokoBot.findUniqueOrThrow({
      where: { id: lane.cusoBotId },
    });
    expect(cuso.proactivePaused).toBe(false);
    expect(cuso.versionId).toBe("cmo-v1");
    const sokoBot = await prisma.sokoBot.findUniqueOrThrow({
      where: { id: lane.sokoBotId },
    });
    expect(sokoBot.proactivePaused).toBe(true);
    expect(sokoBot.versionId).toBe("v33");
    const balance = await prisma.creditBucket.count({
      where: { organizationId: lane.organizationId },
    });
    expect(balance).toBeGreaterThan(0);

    await pauseEvalLanes(1);
    expect(
      (
        await prisma.sokoBot.findUniqueOrThrow({
          where: { id: lane.cusoBotId },
        })
      ).proactivePaused,
    ).toBe(true);
  });

  it("lets the owner add schedules beside the bot's system rhythms", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
    await resetEvalLaneForSokoBot(lane);
    const rhythms = await prisma.sokoBotSchedule.count({
      where: {
        sokoBotId: lane.sokoBotId,
        enabled: true,
        systemKey: { not: null },
      },
    });
    expect(rhythms).toBeGreaterThanOrEqual(8);
    for (const index of [1, 2, 3, 4])
      await createSokoBotSchedule({
        userId: lane.userId,
        workspaceId: lane.workspaceId,
        sokoBotId: lane.sokoBotId,
        name: `Check-in ${index}`,
        timezone: "Europe/Berlin",
        cronExpression: `0 ${8 + index} * * 1-5`,
        prompt: "Check the board.",
      });
    expect(
      await prisma.sokoBotSchedule.count({
        where: { sokoBotId: lane.sokoBotId, enabled: true, systemKey: null },
      }),
    ).toBe(4);
    await resetEvalLaneForSokoBot(lane);
  });

  it("resets what earlier eval turns made, keeping the seeded world", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
    await prisma.task.create({
      data: {
        name: "Left by an earlier case",
        workspaceId: lane.workspaceId,
        ownerId: lane.userId,
        organizationId: lane.organizationId,
      },
    });
    await prisma.chatRoomMessage.create({
      data: {
        roomId: lane.world.roomId,
        senderSokoBotId: lane.sokoBotId,
        content: "Picking up the launch follow-ups today.",
      },
    });
    const file = await prisma.fileResource.create({
      data: {
        workspaceId: lane.workspaceId,
        sourceKind: "DRIVE_UPLOAD",
        sourceScope: "ORGANIZATION",
        sourceId: `drive/eval-${Date.now()}/launch-notes.md`,
        ownerOrganizationId: lane.organizationId,
        displayName: "launch-notes.md",
        normalizedName: "launch-notes.md",
      },
    });
    await resetEvalLaneForSokoBot(lane);
    expect(
      (await prisma.fileResource.findUniqueOrThrow({ where: { id: file.id } }))
        .tombstonedAt,
    ).not.toBeNull();
    expect(
      await prisma.task.count({
        where: { workspaceId: lane.workspaceId, archivedAt: null },
      }),
    ).toBe(0);
    const messages = await prisma.chatRoomMessage.findMany({
      where: { roomId: lane.world.roomId, deletedAt: null },
    });
    expect(messages).toHaveLength(3);
    expect(messages.every((message) => message.senderSokoBotId === null)).toBe(
      true,
    );
  });
});
