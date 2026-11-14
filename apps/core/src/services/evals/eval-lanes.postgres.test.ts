import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createDataTable } from "@/helpers/data-table";
import prisma from "@/lib/db/prisma";
import {
  evalCoworkerRefusal,
  forgetEvalWorkspaces,
  globalCoworkersFor,
  isEvalWorkspace,
} from "@/lib/evals/eval-guard";
import { evalHistoryFloor } from "@/lib/evals/eval-history";
import { isNewsletterWorkspaceEnabled } from "@/lib/newsletter/feature";
import { ContextPacketBuilder } from "@/lib/soko-bot/context-packet";
import { dreaming } from "@/services/soko-bot-dreaming.service";
import { createSokoBotSchedule } from "@/services/soko-bot-schedule.service";
import {
  ensureEvalLanes,
  pauseEvalLanes,
  prepareEvalLane,
  resetEvalLaneForSokoBot,
} from "./eval-lanes.service";

vi.mock("@vercel/blob", () => ({ del: vi.fn().mockResolvedValue(undefined) }));

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

  it("resets only registered lane-owned tables and retry keys, retaining historical diagnostics", async () => {
    const [lane, other] = await ensureEvalLanes(2);
    if (!lane || !other) throw new Error("no lanes");
    const actor = {
      workspaceId: lane.workspaceId,
      userId: lane.userId,
      actorId: lane.sokoBotId,
      actorKind: "sokoBot" as const,
      ownerChat: true,
    };
    const input = {
      key: `reset-table-${randomUUID()}`,
      title: "First run",
      description: "",
      columns: [
        {
          name: "Finding",
          type: "text" as const,
          description: "",
          options: [],
        },
      ],
      rows: [],
    };
    const table = await createDataTable(actor, input);
    const foreignCreator = await prisma.dataTable.create({
      data: {
        workspaceId: lane.workspaceId,
        createdBy: other.sokoBotId,
        title: "Foreign creator",
      },
    });
    const foreignWorkspace = await prisma.dataTable.create({
      data: {
        workspaceId: other.workspaceId,
        createdBy: lane.sokoBotId,
        title: "Foreign workspace",
      },
    });
    const file = await prisma.fileResource.create({
      data: {
        workspaceId: lane.workspaceId,
        sourceKind: "NATIVE_TABLE",
        sourceScope: "ORGANIZATION",
        sourceId: table.id,
        ownerOrganizationId: lane.organizationId,
        displayName: table.title,
        normalizedName: table.title.toLowerCase(),
      },
    });
    const turn = await prisma.sokoBotTurn.create({
      data: {
        sokoBotId: lane.sokoBotId,
        workspaceId: lane.workspaceId,
        source: "CHAT",
        status: "COMPLETED",
        capabilityNames: ["create_table"],
        clientTurnId: `lab:retained-${randomUUID()}`,
        userMessage: "Create a table",
        deadlineAt: new Date(),
        toolCalls: {
          create: {
            toolCallId: "table",
            capability: "create_table",
            inputHash: "test",
            status: "COMPLETED",
            targetId: table.id,
            result: { id: table.id },
          },
        },
      },
    });
    const run = await prisma.evalRun.create({
      data: {
        trigger: "MANUAL",
        suites: ["soko-bot"],
        repeats: 1,
        environment: "local",
        results: {
          create: {
            caseId: "table-from-chat",
            suite: "soko-bot",
            repeat: 1,
            position: 1,
            turnId: turn.id,
            status: "PASSED",
            output: { tableId: table.id },
          },
        },
      },
    });
    await resetEvalLaneForSokoBot(lane);
    expect(
      await prisma.dataTable.findUnique({ where: { id: table.id } }),
    ).toBeNull();
    expect(
      await prisma.tableOperation.count({
        where: {
          workspaceId: lane.workspaceId,
          actorId: lane.sokoBotId,
          key: input.key,
        },
      }),
    ).toBe(0);
    expect(
      (await prisma.fileResource.findUniqueOrThrow({ where: { id: file.id } }))
        .lifecycle,
    ).toBe("TOMBSTONED");
    expect(
      await prisma.dataTable.count({
        where: { id: { in: [foreignCreator.id, foreignWorkspace.id] } },
      }),
    ).toBe(2);
    expect(
      await prisma.sokoBotTurn.findUnique({ where: { id: turn.id } }),
    ).not.toBeNull();
    expect(
      await prisma.sokoBotToolCall.count({
        where: { turnId: turn.id, targetId: table.id },
      }),
    ).toBe(1);
    expect(
      await prisma.evalResult.count({
        where: { runId: run.id, turnId: turn.id },
      }),
    ).toBe(1);
    const next = await createDataTable(actor, {
      ...input,
      title: "Next run, different input",
    });
    expect(next.id).not.toBe(table.id);
  });

  it("refuses a forged lane tenant or owner before changing fixture data", async () => {
    const [lane, other] = await ensureEvalLanes(2);
    if (!lane || !other) throw new Error("no lanes");
    const task = await prisma.task.create({
      data: {
        name: "Must survive forged reset",
        workspaceId: other.workspaceId,
        ownerId: other.userId,
        organizationId: other.organizationId,
      },
    });
    await expect(
      resetEvalLaneForSokoBot({ ...lane, workspaceId: other.workspaceId }),
    ).rejects.toThrow("Registered eval lane required");
    await expect(
      resetEvalLaneForSokoBot({ ...lane, userId: other.userId }),
    ).rejects.toThrow("Registered eval lane required");
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
        .archivedAt,
    ).toBeNull();
    const ownerWhere = {
      userId_organizationId: {
        userId: lane.userId,
        organizationId: lane.organizationId,
      },
    };
    await prisma.member.update({ where: ownerWhere, data: { role: "member" } });
    try {
      await expect(resetEvalLaneForSokoBot(lane)).rejects.toThrow(
        "Registered eval lane required",
      );
    } finally {
      await prisma.member.update({
        where: ownerWhere,
        data: { role: "owner" },
      });
    }
  });

  it("seeds owner-confirmed team roles into current memory after each reset", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
    for (let resetIndex = 0; resetIndex < 2; resetIndex += 1) {
      await resetEvalLaneForSokoBot(lane);
      const bot = await prisma.sokoBot.findUniqueOrThrow({
        where: { id: lane.sokoBotId },
      });
      const current = await prisma.sokoBotMemoryRevision.findUniqueOrThrow({
        where: {
          sokoBotId_version: {
            sokoBotId: lane.sokoBotId,
            version: bot.memoryVersion,
          },
        },
      });
      expect(current.source).toBe("eval_fixture");
      expect(current.markdown).toContain(
        "Robin Keller confirmed these team roles: Hannah Weber handles research; Alex Kim handles writing.",
      );
      expect(current.hash).toBe(bot.memoryHash);
      const reset = await prisma.sokoBotMemoryRevision.findFirstOrThrow({
        where: { sokoBotId: lane.sokoBotId, source: "user_reset" },
        orderBy: { version: "desc" },
      });
      expect(current.version).toBe(reset.version + 1);
      expect(
        await evalHistoryFloor({
          workspaceId: lane.workspaceId,
          sokoBotId: lane.sokoBotId,
        }),
      ).toEqual(reset.createdAt);
    }
  });

  it("limits history only for the registered bot in its eval workspace", async () => {
    const [lane, other] = await ensureEvalLanes(2);
    if (!lane || !other) throw new Error("no lanes");
    await resetEvalLaneForSokoBot(lane);
    const reset = await prisma.sokoBotMemoryRevision.findFirstOrThrow({
      where: { sokoBotId: lane.sokoBotId, source: "user_reset" },
      orderBy: { version: "desc" },
    });
    expect(
      await evalHistoryFloor({
        workspaceId: lane.workspaceId,
        sokoBotId: lane.sokoBotId,
      }),
    ).toEqual(reset.createdAt);
    expect(
      await evalHistoryFloor({
        workspaceId: other.workspaceId,
        sokoBotId: lane.sokoBotId,
      }),
    ).toBeNull();
    expect(
      await evalHistoryFloor({
        workspaceId: randomUUID(),
        sokoBotId: lane.sokoBotId,
      }),
    ).toBeNull();
  });

  it("builds fresh context and dreams from real retained history and the seeded newsletter", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
    await resetEvalLaneForSokoBot(lane);
    const floor = await evalHistoryFloor({
      workspaceId: lane.workspaceId,
      sokoBotId: lane.sokoBotId,
    });
    if (!floor) throw new Error("missing reset floor");
    const historical = await prisma.sokoBotTurn.create({
      data: {
        sokoBotId: lane.sokoBotId,
        workspaceId: lane.workspaceId,
        requestedByUserId: lane.userId,
        source: "CHAT",
        status: "COMPLETED",
        clientTurnId: `lab:old-context-${randomUUID()}`,
        capabilityNames: [],
        userMessage: "Historical world question",
        finalAnswer: "Historical world answer",
        createdAt: new Date(floor.getTime() - 1_000),
        completedAt: new Date(floor.getTime() - 1_000),
        deadlineAt: floor,
      },
    });
    const current = await prisma.sokoBotTurn.create({
      data: {
        sokoBotId: lane.sokoBotId,
        workspaceId: lane.workspaceId,
        requestedByUserId: lane.userId,
        source: "CHAT",
        status: "COMPLETED",
        clientTurnId: `lab:current-context-${randomUUID()}`,
        capabilityNames: [],
        userMessage: "Current eval world question",
        finalAnswer: "Current eval world answer",
        createdAt: new Date(floor.getTime() + 1),
        completedAt: new Date(),
        deadlineAt: new Date(),
      },
    });
    const { packet, counts } = await new ContextPacketBuilder().build({
      userId: lane.userId,
      workspaceId: lane.workspaceId,
      sokoBotId: lane.sokoBotId,
      sharedScope: null,
      source: "CHAT",
      classification: {
        schemaVersion: 1,
        route: "DIRECT_RESPONSE",
        confidence: 1,
        rationaleSummary: "Read current context",
        requestedOutcome: "Read current context",
        candidateProjectIds: [],
        candidateCoworkerIds: [],
        candidateAgentIds: [],
        requiresClarification: false,
        requiresApproval: false,
      },
    });
    expect(packet.recentTurns.map((turn) => turn.id)).toEqual([current.id]);
    expect(counts.recentTurns).toBe(1);
    expect(
      packet.projects
        .filter(
          (project) => (project.newsletter as { available: boolean }).available,
        )
        .map((project) => project.id),
    ).toEqual([lane.world.marketingProjectId]);
    expect(
      packet.projects.some(
        (project) =>
          project.id === lane.cusoProjectId && project.name === "Eval brand",
      ),
    ).toBe(true);
    const dream = await dreaming(
      {
        id: lane.sokoBotId,
        userId: lane.userId,
        workspaceId: lane.workspaceId,
        ingestTimezone: "UTC",
      },
      new Date(),
    );
    expect(dream.lines.join("\n")).toContain("Current eval world question");
    expect(dream.lines.join("\n")).not.toContain("Historical world question");
    expect(
      await prisma.sokoBotTurn.findUnique({ where: { id: historical.id } }),
    ).not.toBeNull();
  });
});
