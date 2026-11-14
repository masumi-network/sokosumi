import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { SokoBotRuntimeService } from "../soko-bot-runtime.service";

vi.mock("@vercel/functions", () => ({
  attachDatabasePool: vi.fn(),
  waitUntil: vi.fn(),
}));
vi.mock("@/lib/soko-bot/jev", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/soko-bot/jev")>()),
  askJev: vi.fn(async () => new Map([["chases", 0]])),
}));

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const TURN_LIFETIME_MS = 120_000;
const userId = `event-comment-owner-${randomUUID()}`;
const workspaceId = randomUUID();
const botId = randomUUID();
const service = new SokoBotRuntimeService();

describe.runIf(enabled)("EVENT recovery comments against PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Recovery owner",
        email: `${userId}@fixture.invalid`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.workspace.create({ data: { id: workspaceId, userId } });
    await prisma.sokoBot.create({
      data: { id: botId, userId, workspaceId, status: "RUNNING" },
    });
  });
  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function fixture(source: "EVENT" | "CHAT" = "EVENT") {
    const task = await prisma.task.create({
      data: {
        workspaceId,
        ownerId: userId,
        assigneeUserId: userId,
        name: "Recover blocked research",
        status: "FAILED",
      },
    });
    const failed = await prisma.taskEvent.create({
      data: {
        taskId: task.id,
        status: "FAILED",
        userId,
        comment: "One source returned 403.",
      },
    });
    const turn = await prisma.sokoBotTurn.create({
      data: {
        sokoBotId: botId,
        workspaceId,
        requestedByUserId: userId,
        source,
        status: "RUNNING",
        clientTurnId: randomUUID(),
        userMessage: "Recover the research from accessible sources.",
        capabilityNames: ["reply_to_task", "create_table"],
        deadlineAt: new Date(Date.now() + TURN_LIFETIME_MS),
        leaseExpiresAt: new Date(Date.now() + TURN_LIFETIME_MS),
        contextSnapshot: {
          create: {
            generatedAt: new Date(),
            schemaVersion: 1,
            hash: "event-comment-fixture",
            packet: { memory: { version: 0 } },
            byteSize: 0,
            tokenEstimate: 0,
            counts: {},
            omissions: {},
          },
        },
      },
    });
    if (source === "EVENT")
      await prisma.sokoBotEventInbox.create({
        data: {
          botId,
          turnId: turn.id,
          eventId: failed.id,
          entityId: task.id,
          purpose: "TASK_STATUS",
          designatedHandlerBotId: botId,
        },
      });
    const request = {
      turnId: turn.id,
      sessionId: `event-comment-${turn.id}`,
      capability: "reply_to_task" as const,
    };
    const reply = (comment: string, status?: "READY") => ({
      ...request,
      toolCallId: randomUUID(),
      input: { taskId: task.id, comment, ...(status ? { status } : {}) },
    });
    return { task, turn, request, reply };
  }

  it("commits one comment for overlapping recovery calls, replays safely, and still permits READY", async () => {
    const setup = await fixture();
    const inputs = [
      setup.reply(
        "Use accessible primary sources; mark missing prices unknown.",
      ),
      setup.reply(
        "Continue independent research with accessible sources; never bypass the 403.",
      ),
    ];
    const results = await Promise.all(
      inputs.map((input) => service.executeTool(input)),
    );
    expect(
      await prisma.taskEvent.count({
        where: { taskId: setup.task.id, sokoBotId: botId, status: null },
      }),
    ).toBe(1);
    expect(
      results.filter((result) => (result as { commented: boolean }).commented),
    ).toHaveLength(1);
    expect(results).toContainEqual(
      expect.objectContaining({
        alreadyCommented: true,
        commented: false,
        statusChanged: false,
        status: "FAILED",
      }),
    );
    const receipts = await prisma.sokoBotToolCall.findMany({
      where: { turnId: setup.turn.id, capability: "reply_to_task" },
    });
    expect(receipts.map((receipt) => receipt.disposition).sort()).toEqual([
      "ALREADY_SATISFIED",
      "APPLIED",
    ]);
    expect(
      await prisma.sokoBotEffectOutbox.count({
        where: {
          receiptId: { in: receipts.map((receipt) => receipt.id) },
          purpose: "TASK_EVENT",
        },
      }),
    ).toBe(1);
    expect(await service.executeTool(inputs[0])).toEqual(results[0]);
    const retry = await service.executeTool(
      setup.reply("Retry recovery with this equivalent guidance."),
    );
    expect(retry).toMatchObject({ commented: false, alreadyCommented: true });
    const resumed = await service.executeTool(
      setup.reply("The independent research may resume now.", "READY"),
    );
    expect(resumed).toMatchObject({
      status: "READY",
      statusChanged: true,
      commented: true,
    });
    expect(
      await service.executeTool(
        setup.reply("One more comment must not duplicate the recovery."),
      ),
    ).toMatchObject({
      status: "READY",
      alreadyCommented: true,
      commented: false,
    });
    expect(
      await prisma.taskEvent.count({
        where: { taskId: setup.task.id, sokoBotId: botId },
      }),
    ).toBe(2);
  });
  it("keeps two owner-requested CHAT comments as separate effects", async () => {
    const setup = await fixture("CHAT");
    for (const text of [
      "Use accessible sources.",
      "Also include the owner's new pricing assumption.",
    ])
      expect(await service.executeTool(setup.reply(text))).toMatchObject({
        commented: true,
      });
    expect(
      await prisma.taskEvent.count({
        where: { taskId: setup.task.id, sokoBotId: botId, status: null },
      }),
    ).toBe(2);
  });

  it("does not let table publication consume or get blocked by the recovery comment", async () => {
    const setup = await fixture();
    await prisma.task.update({
      where: { id: setup.task.id },
      data: { assigneeUserId: null, assigneeSokoBotId: botId, status: "READY" },
    });
    const table = (title: string) =>
      service.executeTool({
        ...setup.request,
        capability: "create_table",
        toolCallId: randomUUID(),
        input: {
          key: randomUUID(),
          title,
          taskId: setup.task.id,
          columns: [{ name: "Source", type: "text" }],
          rows: [],
        },
      });
    await table("Source evidence before recovery");
    expect(
      await service.executeTool(
        setup.reply("Use these accessible sources for recovery."),
      ),
    ).toMatchObject({ commented: true });
    await table("Source evidence after recovery");
    expect(
      await service.executeTool(
        setup.reply("Do not post duplicate recovery guidance."),
      ),
    ).toMatchObject({ commented: false, alreadyCommented: true });
    const events = await prisma.taskEvent.findMany({
      where: { taskId: setup.task.id, sokoBotId: botId, status: null },
    });
    expect(events).toHaveLength(3);
    expect(
      events.filter((event) => event.comment?.startsWith("[Open table]")),
    ).toHaveLength(2);
  });

  it.each(["missing", "blank"])(
    "requires a real meaningful event, not a %s event or receipt result",
    async (kind) => {
      const setup = await fixture();
      const effectEventId =
        kind === "blank"
          ? (
              await prisma.taskEvent.create({
                data: {
                  taskId: setup.task.id,
                  sokoBotId: botId,
                  comment: "   ",
                },
              })
            ).id
          : randomUUID();
      await prisma.sokoBotToolCall.create({
        data: {
          turnId: setup.turn.id,
          toolCallId: randomUUID(),
          capability: "reply_to_task",
          input: { taskId: setup.task.id, comment: "Fabricated old recovery." },
          inputHash: "forged-fixture",
          actorBotId: botId,
          targetId: setup.task.id,
          status: "COMPLETED",
          disposition: "APPLIED",
          verification: "LOCAL_TRANSACTION",
          committedAt: new Date(),
          effectEventId,
          result: { commented: true, status: "FAILED", eventId: randomUUID() },
        },
      });
      expect(
        await service.executeTool(
          setup.reply("Real guidance uses accessible primary sources."),
        ),
      ).toMatchObject({ commented: true });
      const actual = await prisma.taskEvent.findMany({
        where: { taskId: setup.task.id, sokoBotId: botId },
      });
      expect(actual.filter((event) => event.comment?.trim())).toHaveLength(1);
      const other = await prisma.task.create({
        data: {
          workspaceId,
          ownerId: userId,
          name: "Other visible Task",
          status: "FAILED",
        },
      });
      expect(
        await service.executeTool({
          ...setup.reply("Separate guidance for another visible Task."),
          input: {
            taskId: other.id,
            comment: "Separate guidance for another visible Task.",
          },
        }),
      ).toMatchObject({ commented: true });
    },
  );
});
