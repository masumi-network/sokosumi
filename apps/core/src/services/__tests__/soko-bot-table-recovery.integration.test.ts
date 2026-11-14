import { randomUUID } from "node:crypto";
import type { SokoBotCapability } from "@sokosumi/soko-bot";
import { CHAT_MENTION_MESSAGE_KEY } from "@sokosumi/utils";
import { v5 as uuidv5 } from "uuid";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import { publishChatRoomMessageRealtimeById } from "@/helpers/chat-room-message-realtime";
import { dispatchNotificationPublish } from "@/helpers/notification-publish";
import { publishNotificationEvent } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import { actionInputHash } from "@/lib/soko-bot/action-receipts";
import { deliverSokoBotEffect } from "@/services/soko-bot-effect-outbox.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeService,
} from "@/services/soko-bot-runtime.service";

const pending = vi.hoisted(() => [] as Promise<unknown>[]);
// Exercise actual publication, effects and notification persistence.
vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ably/publish", () => ({
  publishTaskEventData: vi.fn().mockResolvedValue(undefined),
  publishChatRoomsChanged: vi.fn().mockResolvedValue(undefined),
  publishNotificationEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@vercel/functions", () => ({
  attachDatabasePool: vi.fn(),
  waitUntil: vi.fn((promise: Promise<unknown>) => pending.push(promise)),
}));
const userId = randomUUID(),
  workspaceId = randomUUID(),
  sokoBotId = randomUUID();
const tableCapabilities = [
  "create_table",
  "write_table_rows",
  "update_table_columns",
] as const;
const capabilities = [
  ...tableCapabilities,
  "post_chat",
  "reply_to_task",
] satisfies SokoBotCapability[];
const createdSchema = z.object({
  table: z.object({
    id: z.uuid(),
    columns: z.array(z.object({ id: z.uuid() })),
  }),
  url: z.string(),
});

async function drainPending() {
  while (pending.length > 0) await Promise.all(pending.splice(0));
}
// The first scheduled attempt can run before its writer's transaction commits.
// Exercise the real retry dispatcher and require publication, never just removal.
async function publishQueuedNotification(id: string) {
  const notification = await prisma.notification.findUniqueOrThrow({
    where: { id },
  });
  if (notification.publishId) {
    expect(notification.publishNextAttemptAt).not.toBeNull();
    expect(
      await dispatchNotificationPublish(
        id,
        new Date(notification.publishNextAttemptAt!.getTime() + 61_000),
      ),
    ).toBe("published");
  }
}

/** A real PostgreSQL error at the requested persistence boundary. The fixture owns this database. */
async function databaseFault(
  table:
    | "soko_bot_tool_call"
    | "chat_room_message"
    | "taskEvent"
    | "notification",
  timing: "BEFORE" | "AFTER",
  event: "INSERT" | "UPDATE",
  condition: string,
  action: () => Promise<void>,
) {
  const name = `table_fixture_${randomUUID().replaceAll("-", "")}`;
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture database interruption'; END $$`,
  );
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "${name}" ${timing} ${event} ON "${table}" FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION "${name}"()`,
    );
    await action();
  } finally {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${name}" ON "${table}"`,
    );
    await prisma.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
  }
}

describe.runIf(process.env.RUN_DATABASE_INTEGRATION_TESTS === "true")(
  "R2 durable table runtime recovery",
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        !url.pathname.includes("native_tables")
      )
        throw Error("Own isolated database required");
      await prisma.user.create({
        data: {
          id: userId,
          name: "Receipt fixture",
          email: `${userId}@fixture.invalid`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await prisma.workspace.create({ data: { id: workspaceId, userId } });
      await prisma.sokoBot.create({
        data: { id: sokoBotId, userId, workspaceId },
      });
    });
    afterEach(async () => {
      await drainPending();
      vi.restoreAllMocks();
      vi.clearAllMocks();
    });
    afterAll(async () => {
      await prisma.chatRoom.deleteMany({ where: { createdByUserId: userId } });
      await prisma.task.deleteMany({ where: { workspaceId } });
      await prisma.workspace.delete({ where: { id: workspaceId } });
      await prisma.user.delete({ where: { id: userId } });
      await prisma.$disconnect();
    });
    async function setup() {
      const turn = await prisma.sokoBotTurn.create({
        data: {
          requestedByUserId: userId,
          workspaceId,
          sokoBotId,
          source: "CHAT",
          status: "RUNNING",
          leaseExpiresAt: new Date(Date.now() + 600000),
          clientTurnId: randomUUID(),
          userMessage: "Research",
          capabilityNames: capabilities,
          deadlineAt: new Date(Date.now() + 600000),
          eveSessionId: randomUUID(),
        },
      });
      const authorized: AuthorizedSokoBotRuntime = {
        toolCallLimit: 64,
        askedByKind: "OWNER",
        turn: { ...turn, actingUserId: userId },
        classificationConfidence: 1,
        reader: { userId, audience: undefined, sharedScope: null },
        grant: {
          userId,
          workspaceId,
          sokoBotId,
          issuer: "test",
          audience: "test",
          subject: sokoBotId,
          jwtId: randomUUID(),
          sessionId: turn.eveSessionId!,
          turnId: turn.id,
          contextSnapshotId: randomUUID(),
          memoryRevisionId: null,
          memoryVersion: 0,
          capabilities,
          issuedAt: 0,
          expiresAt: 9999999999,
        },
      };
      const runtime = new SokoBotRuntimeService();
      const authorize = vi
        .spyOn(runtime, "authorize")
        .mockResolvedValue(authorized);
      const request = {
        turnId: turn.id,
        sessionId: turn.eveSessionId!,
        toolCallId: randomUUID(),
      };
      return { runtime, authorize, authorized, request, turn };
    }
    function createInput() {
      return {
        key: randomUUID(),
        title: "Recovery",
        columns: [{ id: randomUUID(), name: "Company", type: "text" }],
      };
    }
    async function chatDestination(turnId: string, roomId?: string) {
      const room = roomId
        ? { id: roomId }
        : await prisma.chatRoom.create({
            data: {
              name: "Publication",
              kind: "direct",
              createdByUserId: userId,
              directKey: randomUUID(),
            },
          });
      if (!roomId) {
        await prisma.chatRoomSokoBotMember.create({
          data: { roomId: room.id, sokoBotId },
        });
        await prisma.chatRoomUserMember.create({
          data: { roomId: room.id, userId },
        });
      }
      const message = await prisma.chatRoomMessage.create({
        data: { roomId: room.id, content: "Research", senderUserId: userId },
      });
      const mention = await prisma.chatRoomMention.create({
        data: { messageId: message.id, sokoBotId },
      });
      await prisma.sokoBotTurn.update({
        where: { id: turnId },
        data: { chatMentionId: mention.id },
      });
      return room.id;
    }
    async function taskDestination() {
      return (
        await prisma.task.create({
          data: {
            ownerId: userId,
            creatorUserId: userId,
            workspaceId,
            name: "Publication",
            status: "RUNNING",
            assigneeSokoBotId: sokoBotId,
          },
        })
      ).id;
    }
    async function effects(turnId: string) {
      return prisma.sokoBotEffectOutbox.findMany({
        where: { receipt: { turnId } },
        orderBy: { createdAt: "asc" },
      });
    }
    async function deliver(turnId: string) {
      const queued = await effects(turnId);
      const results = [];
      for (const effect of queued)
        if (["PENDING", "PERSISTED"].includes(effect.status)) {
          await prisma.sokoBotEffectOutbox.update({
            where: { id: effect.id },
            data: { nextAttemptAt: new Date(0) },
          });
          results.push(await deliverSokoBotEffect(effect.id));
        }
      await drainPending();
      return results;
    }
    function receiptWhere(request: { turnId: string; toolCallId: string }) {
      return {
        turnId_toolCallId: {
          turnId: request.turnId,
          toolCallId: request.toolCallId,
        },
      };
    }

    it("persists named initial values and evidence and replays the exact request", async () => {
      const { runtime, request } = await setup();
      const input = createInput(),
        columnId = input.columns[0].id;
      const body = {
        ...input,
        rows: [
          {
            values: { Company: "Sokosumi" },
            evidence: { Company: [{ url: "https://sokosumi.com" }] },
          },
        ],
      };
      const call = {
        ...request,
        capability: "create_table" as const,
        input: body,
      };
      const result = createdSchema.parse(await runtime.executeTool(call));
      const rows = await prisma.tableRow.findMany({
        where: { tableId: result.table.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].values).toEqual({ [columnId]: "Sokosumi" });
      expect(rows[0].evidence).toEqual({
        [columnId]: [{ url: "https://sokosumi.com" }],
      });
      expect(
        createdSchema.parse(await runtime.executeTool(call)).table.id,
      ).toBe(result.table.id);
      expect(
        await prisma.tableRow.count({ where: { tableId: result.table.id } }),
      ).toBe(1);
    });
    it("keeps same-chat post_chat blocked when raw input spoofs an internal publication ID", async () => {
      const { runtime, request, turn } = await setup();
      const roomId = await chatDestination(turn.id);
      await expect(
        runtime.executeTool({
          ...request,
          capability: "post_chat",
          input: {
            roomId,
            content: "Duplicate answer",
            publicationId: randomUUID(),
          },
        }),
      ).rejects.toThrow("Your answer to this message is posted for you");
      expect(
        await prisma.chatRoomMessage.count({
          where: { roomId, senderSokoBotId: sokoBotId },
        }),
      ).toBe(0);
    });
    it.each(["post_chat", "reply_to_task"] as const)(
      "requires the separate %s capability for table publication",
      async (missing) => {
        const { runtime, request, turn, authorized, authorize } = await setup();
        const destination =
          missing === "post_chat"
            ? { roomId: await chatDestination(turn.id) }
            : { taskId: await taskDestination() };
        authorize.mockResolvedValue({
          ...authorized,
          grant: {
            ...authorized.grant,
            capabilities: capabilities.filter(
              (capability) => capability !== missing,
            ),
          },
        });
        const before = await prisma.dataTable.count({ where: { workspaceId } });
        await expect(
          runtime.executeTool({
            ...request,
            capability: "create_table",
            input: {
              ...createInput(),
              ...("taskId" in destination
                ? { taskId: destination.taskId }
                : {}),
            },
          }),
        ).rejects.toThrow(
          "Table link publication requires its own capability grant",
        );
        expect(await prisma.dataTable.count({ where: { workspaceId } })).toBe(
          before,
        );
      },
    );
    it.each(tableCapabilities)(
      "recovers %s after receipt failure without duplicate changes",
      async (capability) => {
        const { runtime, request, authorize } = await setup();
        const initial = createdSchema.parse(
          await runtime.executeTool({
            ...request,
            toolCallId: randomUUID(),
            capability: "create_table",
            input: createInput(),
          }),
        );
        const input =
          capability === "create_table"
            ? createInput()
            : capability === "write_table_rows"
              ? {
                  tableId: initial.table.id,
                  key: randomUUID(),
                  insert: [
                    { values: { [initial.table.columns[0].id]: "Acme" } },
                  ],
                }
              : {
                  tableId: initial.table.id,
                  key: randomUUID(),
                  version: 1,
                  columns: [
                    {
                      id: initial.table.columns[0].id,
                      name: "Renamed",
                      type: "text",
                    },
                  ],
                };
        const call = { ...request, capability, input };
        const counts = async () => [
          await prisma.dataTable.count({ where: { workspaceId } }),
          await prisma.tableRow.count({ where: { tableId: initial.table.id } }),
          await prisma.tableChange.count({
            where: { tableId: initial.table.id },
          }),
        ];
        const before = await counts();
        await databaseFault(
          "soko_bot_tool_call",
          "BEFORE",
          "UPDATE",
          `NEW."turnId" = '${request.turnId}'::uuid AND NEW."toolCallId" = '${request.toolCallId}' AND NEW."status"::text = 'COMPLETED'`,
          async () => {
            await expect(runtime.executeTool(call)).rejects.toThrow(
              "fixture database interruption",
            );
          },
        );
        // Receipt and effect now commit together. A failed receipt rolls back the effect.
        expect(await counts()).toEqual(before);
        expect(
          await prisma.sokoBotToolCall.findUniqueOrThrow({
            where: receiptWhere(request),
          }),
        ).toMatchObject({
          status: "FAILED",
          verification: "NONE",
          committedAt: null,
        });
        await expect(
          runtime.executeTool({
            ...call,
            input: { ...input, key: randomUUID() },
          }),
        ).rejects.toThrow("different input");
        await expect(
          runtime.executeTool({ ...call, capability: "read_table" }),
        ).rejects.toThrow("different input");
        authorize.mockRejectedValueOnce(new Error("grant revoked"));
        await expect(runtime.executeTool(call)).rejects.toThrow(
          "grant revoked",
        );
        const result = await runtime.executeTool(call),
          committed = await counts();
        expect(await runtime.executeTool(call)).toEqual(result);
        expect(await counts()).toEqual(committed);
        expect(
          await prisma.sokoBotToolCall.findUniqueOrThrow({
            where: receiptWhere(request),
          }),
        ).toMatchObject({
          status: "COMPLETED",
          verification: "LOCAL_TRANSACTION",
        });
        if (capability === "create_table")
          expect(committed[0]).toBe(before[0] + 1);
        else if (capability === "write_table_rows")
          expect(committed[1]).toBe(before[1] + 1);
        else
          expect(result).toMatchObject({
            version: 2,
            columns: [expect.objectContaining({ name: "Renamed" })],
          });
      },
    );
    it.each([false, true])(
      "recovers publication failure (already staged: %s)",
      async (staged) => {
        const { runtime, request, turn } = await setup();
        const roomId = await chatDestination(turn.id),
          input = createInput(),
          before = await prisma.dataTable.count({ where: { workspaceId } });
        const call = { ...request, capability: "create_table" as const, input };
        await databaseFault(
          "chat_room_message",
          staged ? "AFTER" : "BEFORE",
          "INSERT",
          `NEW."roomId" = '${roomId}'::uuid AND NEW."senderSokoBotId" = '${sokoBotId}'::uuid`,
          async () => {
            await expect(runtime.executeTool(call)).rejects.toThrow(
              "fixture database interruption",
            );
          },
        );
        expect(await prisma.dataTable.count({ where: { workspaceId } })).toBe(
          before,
        );
        expect(
          await prisma.chatRoomMessage.count({
            where: { roomId, senderSokoBotId: sokoBotId },
          }),
        ).toBe(0);
        const result = createdSchema.parse(await runtime.executeTool(call));
        expect(await deliver(turn.id)).toEqual([true]);
        const links = await prisma.chatRoomMessage.findMany({
          where: { roomId, senderSokoBotId: sokoBotId },
        });
        expect(links).toHaveLength(1);
        expect(links[0].content).toContain(result.url);
        expect(await runtime.executeTool(call)).toMatchObject(result);
        expect(await prisma.dataTable.count({ where: { workspaceId } })).toBe(
          before + 1,
        );
      },
    );
    it.each([0, 3])(
      "table publication bypasses and does not consume ordinary budget (%s prior replies)",
      async (prior) => {
        const { runtime, request } = await setup(),
          taskId = await taskDestination();
        const reply = (comment: string) =>
          runtime.executeTool({
            ...request,
            toolCallId: randomUUID(),
            capability: "reply_to_task",
            input: { taskId, comment },
          });
        for (let i = 0; i < prior; i++) await reply(`Ordinary ${i}`);
        const call = {
            ...request,
            capability: "create_table" as const,
            input: { ...createInput(), taskId },
          },
          result = createdSchema.parse(await runtime.executeTool(call));
        expect(
          await prisma.taskEvent.count({
            where: { taskId, comment: `[Open table](${result.url})` },
          }),
        ).toBe(1);
        for (let i = prior; i < 3; i++) {
          // Canonical-looking text with a normal event ID still consumes budget.
          await reply(
            i === prior ? `[Open table](${result.url})` : `Ordinary ${i}`,
          );
        }
        await expect(reply("Fourth ordinary reply")).rejects.toThrow(
          "already commented 3 times",
        );
        expect(
          await runtime.executeTool({ ...call, toolCallId: randomUUID() }),
        ).toMatchObject(result);
        await prisma.task.update({
          where: { id: taskId },
          data: { assigneeSokoBotId: null },
        });
        await expect(
          runtime.executeTool({ ...call, toolCallId: randomUUID() }),
        ).rejects.toThrow("not assigned");
      },
    );
    it("counts noncanonical text even with a deterministic publication ID", async () => {
      const { runtime, request } = await setup(),
        taskId = await taskDestination(),
        tableId = randomUUID();
      await prisma.taskEvent.create({
        data: {
          id: uuidv5(`table-created:task:${taskId}:${sokoBotId}`, tableId),
          taskId,
          sokoBotId,
          channel: "SOKOSUMI",
          comment: `[Open table](/drive/tables/${tableId})\n`,
        },
      });
      for (let i = 0; i < 2; i++)
        await runtime.executeTool({
          ...request,
          toolCallId: randomUUID(),
          capability: "reply_to_task",
          input: { taskId, comment: `Ordinary ${i}` },
        });
      await expect(
        runtime.executeTool({
          ...request,
          toolCallId: randomUUID(),
          capability: "reply_to_task",
          input: { taskId, comment: "Fourth ordinary reply" },
        }),
      ).rejects.toThrow("already commented 3 times");
    });
    it.each([
      { destination: "chat", separateTurns: false },
      { destination: "task", separateTurns: false },
      { destination: "chat", separateTurns: true },
      { destination: "task", separateTurns: true },
    ])(
      "R3: concurrent distinct calls publish one $destination reference (separate turns: $separateTurns)",
      async ({ destination, separateTurns }) => {
        const first = await setup(),
          second = separateTurns
            ? await setup()
            : { ...first, runtime: new SokoBotRuntimeService() };
        if (!separateTurns)
          vi.spyOn(second.runtime, "authorize").mockResolvedValue(
            first.authorized,
          );
        const id =
          destination === "chat"
            ? await chatDestination(first.turn.id)
            : await taskDestination();
        if (destination === "chat" && separateTurns)
          await chatDestination(second.turn.id, id);
        const input = {
            ...createInput(),
            ...(destination === "task" ? { taskId: id } : {}),
          },
          before = await prisma.dataTable.count({ where: { workspaceId } });
        // Execute real Prisma transactions from independent runtime instances. No barrier inside the shared key lock.
        const results = await Promise.all(
          [first, second].map(({ runtime, request }, i) =>
            runtime.executeTool({
              ...request,
              toolCallId: `concurrent-${i}`,
              capability: "create_table",
              input,
            }),
          ),
        );
        expect(results[0]).toEqual(results[1]);
        expect(await prisma.dataTable.count({ where: { workspaceId } })).toBe(
          before + 1,
        );
        await deliver(first.turn.id);
        if (separateTurns) await deliver(second.turn.id);
        const result = createdSchema.parse(results[0]);
        if (destination === "chat") {
          const links = await prisma.chatRoomMessage.findMany({
            where: { roomId: id, senderSokoBotId: sokoBotId },
          });
          expect(links).toHaveLength(1);
          expect(links[0].content).toContain(result.url);
        } else {
          const links = await prisma.taskEvent.findMany({
            where: { taskId: id, sokoBotId },
          });
          expect(links).toHaveLength(1);
          expect(links[0].comment).toContain(result.url);
        }
        expect(
          await first.runtime.executeTool({
            ...first.request,
            toolCallId: "concurrent-0",
            capability: "create_table",
            input,
          }),
        ).toEqual(results[0]);
      },
    );
    it.each([false, true])(
      "R3: task publication recovers before/after staged persistence (staged: %s)",
      async (staged) => {
        const { runtime, request } = await setup(),
          taskId = await taskDestination();
        const call = {
          ...request,
          capability: "create_table" as const,
          input: { ...createInput(), taskId },
        };
        await databaseFault(
          "taskEvent",
          staged ? "AFTER" : "BEFORE",
          "INSERT",
          `NEW."taskId" = '${taskId}' AND NEW."sokoBotId" = '${sokoBotId}'::uuid`,
          async () => {
            await expect(runtime.executeTool(call)).rejects.toThrow(
              "fixture database interruption",
            );
          },
        );
        expect(
          await prisma.taskEvent.count({ where: { taskId, sokoBotId } }),
        ).toBe(0);
        const recovered = await runtime.executeTool({
          ...call,
          toolCallId: randomUUID(),
        });
        expect(await runtime.executeTool(call)).toEqual(recovered);
        const result = createdSchema.parse(recovered),
          events = await prisma.taskEvent.findMany({
            where: { taskId, sokoBotId },
          });
        expect(events).toHaveLength(1);
        expect(events[0].comment).toContain(result.url);
        expect(
          await prisma.sokoBotDelegation.count({ where: { taskId } }),
        ).toBe(1);
        await expect(
          runtime.executeTool({
            ...call,
            input: { ...call.input, title: "Different intent" },
          }),
        ).rejects.toThrow("different input");
      },
    );
    it("R3: chat publication is isolated by table and destination, with fresh membership checks", async () => {
      const first = await setup(),
        second = await setup(),
        a = await chatDestination(first.turn.id),
        b = await chatDestination(second.turn.id),
        input = createInput();
      const call = {
          ...first.request,
          capability: "create_table" as const,
          input,
        },
        result = await first.runtime.executeTool(call);
      expect(
        await second.runtime.executeTool({
          ...second.request,
          capability: "create_table",
          input,
        }),
      ).toEqual(result);
      await first.runtime.executeTool({
        ...call,
        toolCallId: randomUUID(),
        input: createInput(),
      });
      await deliver(first.turn.id);
      await deliver(second.turn.id);
      const aLinks = await prisma.chatRoomMessage.findMany({
          where: { roomId: a, senderSokoBotId: sokoBotId },
        }),
        bLinks = await prisma.chatRoomMessage.findMany({
          where: { roomId: b, senderSokoBotId: sokoBotId },
        });
      expect(aLinks).toHaveLength(2);
      expect(bLinks).toHaveLength(1);
      expect(new Set([...aLinks, ...bLinks].map((link) => link.id)).size).toBe(
        3,
      );
      expect(aLinks.some((link) => link.content === bLinks[0].content)).toBe(
        true,
      );
      const staged = await first.runtime.executeTool({
        ...call,
        toolCallId: randomUUID(),
        input: createInput(),
      });
      expect(staged).toHaveProperty("url");
      await prisma.chatRoomSokoBotMember.deleteMany({
        where: { roomId: a, sokoBotId },
      });
      expect(await deliver(first.turn.id)).toEqual([false]);
      expect(
        await prisma.chatRoomMessage.count({
          where: { roomId: a, senderSokoBotId: sokoBotId, deletedAt: null },
        }),
      ).toBe(2);
      expect(
        (await effects(first.turn.id)).some(
          (effect) => effect.status === "SUPPRESSED",
        ),
      ).toBe(true);
    });
    it("R3: task publication cannot cross changed task authority or replay a terminal task", async () => {
      const { runtime, request } = await setup(),
        a = await taskDestination(),
        b = await taskDestination(),
        input = { ...createInput(), taskId: a },
        call = { ...request, capability: "create_table" as const, input };
      await runtime.executeTool(call);
      await expect(
        runtime.executeTool({
          ...call,
          toolCallId: randomUUID(),
          input: { ...input, taskId: b },
        }),
      ).rejects.toThrow("Retry key");
      expect(await prisma.taskEvent.count({ where: { taskId: b } })).toBe(0);
      await runtime.executeTool({
        ...call,
        toolCallId: randomUUID(),
        input: { ...createInput(), taskId: b },
      });
      const links = await prisma.taskEvent.findMany({
        where: { taskId: { in: [a, b] } },
      });
      expect(links).toHaveLength(2);
      expect(links[0].id).not.toBe(links[1].id);
      await prisma.task.update({
        where: { id: a },
        data: { status: "COMPLETED" },
      });
      await expect(runtime.executeTool(call)).rejects.toThrow("not assigned");
      expect(await prisma.taskEvent.count({ where: { taskId: a } })).toBe(1);
    });
    it.each(["PENDING", "PERSISTED"] as const)(
      "R4: post-commit interruption recovers a %s delivery, link and deduplicated direct notification",
      async (deliveryStatus) => {
        const { runtime, request, turn } = await setup(),
          roomId = await chatDestination(turn.id),
          call = {
            ...request,
            capability: "create_table" as const,
            input: createInput(),
          };
        const result = createdSchema.parse(await runtime.executeTool(call));
        // The action receipt is atomic; interruption after commit leaves delivery work, not a failed action.
        expect(
          await prisma.sokoBotToolCall.findUniqueOrThrow({
            where: receiptWhere(request),
          }),
        ).toMatchObject({
          status: "COMPLETED",
          verification: "LOCAL_TRANSACTION",
        });
        if (deliveryStatus === "PERSISTED") {
          // This exception models interruption at the post-commit boundary.
          // Production realtime helpers catch ordinary provider errors.
          vi.mocked(publishChatRoomMessageRealtimeById).mockRejectedValueOnce(
            new Error("execution interrupted after message commit"),
          );
          expect(await deliver(turn.id)).toEqual([false]);
          expect((await effects(turn.id))[0].status).toBe("PERSISTED");
        } else expect((await effects(turn.id))[0].status).toBe("PENDING");
        expect(await runtime.executeTool(call)).toMatchObject(result);
        expect(await deliver(turn.id)).toEqual([true]);
        const links = await prisma.chatRoomMessage.findMany({
          where: { roomId, senderSokoBotId: sokoBotId },
        });
        expect(links).toHaveLength(1);
        expect(links[0].content).toContain(result.url);
        const notifications = await prisma.notification.findMany({
          where: { userId, eventId: links[0].id },
        });
        expect(notifications).toHaveLength(1);
        await publishQueuedNotification(notifications[0].id);
        expect(publishNotificationEvent).toHaveBeenCalledTimes(1);
        const readAt = new Date();
        await prisma.notification.update({
          where: { id: notifications[0].id },
          data: { isRead: true, readAt },
        });
        // Concurrent replays must preserve read state and never send a second banner.
        await Promise.all([
          runtime.executeTool(call),
          runtime.executeTool(call),
        ]);
        expect(await deliver(turn.id)).toEqual([]);
        expect(
          await prisma.notification.findMany({
            where: { userId, eventId: links[0].id },
          }),
        ).toEqual([
          expect.objectContaining({
            id: notifications[0].id,
            isRead: true,
            readAt,
            publishId: null,
          }),
        ]);
        expect(publishNotificationEvent).toHaveBeenCalledTimes(1);
      },
    );
    it.each([false, true])(
      "R4: @all table publication preserves one human mention notification across replay (interrupted: %s)",
      async (interrupted) => {
        const { runtime, request, turn } = await setup(),
          roomId = await chatDestination(turn.id),
          call = {
            ...request,
            capability: "create_table" as const,
            input: { ...createInput(), title: "Recovery @all now" },
          };
        await runtime.executeTool(call);
        if (interrupted) {
          vi.mocked(publishChatRoomMessageRealtimeById).mockRejectedValueOnce(
            new Error("interrupted before mention effects"),
          );
          expect(await deliver(turn.id)).toEqual([false]);
        } else expect(await deliver(turn.id)).toEqual([true]);
        const message = await prisma.chatRoomMessage.findFirstOrThrow({
          where: { roomId, senderSokoBotId: sokoBotId },
        });
        expect(
          await prisma.chatRoomUserMention.findMany({
            where: { messageId: message.id },
            select: { userId: true },
          }),
        ).toEqual([{ userId }]);
        expect(
          await prisma.notification.count({ where: { eventId: message.id } }),
        ).toBe(interrupted ? 0 : 1);
        await runtime.executeTool(call);
        await deliver(turn.id);
        const rows = await prisma.notification.findMany({
          where: { eventId: message.id },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].messageKey).toBe(CHAT_MENTION_MESSAGE_KEY);
        await publishQueuedNotification(rows[0].id);
        expect(publishNotificationEvent).toHaveBeenCalledTimes(1);
        const readAt = new Date();
        await prisma.notification.update({
          where: { id: rows[0].id },
          data: { isRead: true, readAt },
        });
        await Promise.all([
          runtime.executeTool(call),
          runtime.executeTool(call),
        ]);
        await deliver(turn.id);
        expect(
          await prisma.notification.findMany({
            where: { eventId: message.id },
          }),
        ).toEqual([
          expect.objectContaining({
            id: rows[0].id,
            isRead: true,
            readAt,
            publishId: null,
          }),
        ]);
        expect(publishNotificationEvent).toHaveBeenCalledTimes(1);
        expect(
          await prisma.chatRoomMessage.count({
            where: { roomId, senderSokoBotId: sokoBotId },
          }),
        ).toBe(1);
      },
    );
    it("R4: notification persistence failure before commit is recovered by the next outbox retry", async () => {
      const { runtime, request, turn } = await setup(),
        roomId = await chatDestination(turn.id),
        call = {
          ...request,
          capability: "create_table" as const,
          input: createInput(),
        };
      const first = createdSchema.parse(await runtime.executeTool(call));
      await databaseFault(
        "notification",
        "BEFORE",
        "INSERT",
        `NEW."userId" = '${userId}'`,
        async () => {
          expect(await deliver(turn.id)).toEqual([false]);
        },
      );
      const message = await prisma.chatRoomMessage.findFirstOrThrow({
        where: { roomId, senderSokoBotId: sokoBotId },
      });
      expect(
        await prisma.notification.count({ where: { eventId: message.id } }),
      ).toBe(0);
      expect(publishNotificationEvent).not.toHaveBeenCalled();
      expect(
        createdSchema.parse(await runtime.executeTool(call)).table.id,
      ).toBe(first.table.id);
      expect(await deliver(turn.id)).toEqual([true]);
      const notifications = await prisma.notification.findMany({
        where: { eventId: message.id },
      });
      expect(notifications).toHaveLength(1);
      await publishQueuedNotification(notifications[0].id);
      expect(publishNotificationEvent).toHaveBeenCalledTimes(1);
    });
    it("R4: committed notification delivery retries through the bounded publisher", async () => {
      const { runtime, request, turn } = await setup(),
        roomId = await chatDestination(turn.id),
        call = {
          ...request,
          capability: "create_table" as const,
          input: createInput(),
        };
      const publish = vi.mocked(publishNotificationEvent);
      publish.mockRejectedValueOnce(new Error("provider unavailable"));
      const first = createdSchema.parse(await runtime.executeTool(call));
      expect(await deliver(turn.id)).toEqual([true]);
      const message = await prisma.chatRoomMessage.findFirstOrThrow({
          where: { roomId, senderSokoBotId: sokoBotId },
        }),
        queued = await prisma.notification.findFirstOrThrow({
          where: { eventId: message.id },
        });
      // A dispatch raced with commit may not yet have reached the provider.
      if (publish.mock.calls.length === 0)
        expect(await dispatchNotificationPublish(queued.id, new Date())).toBe(
          "pending",
        );
      expect(publish).toHaveBeenCalledTimes(1);
      const failed = await prisma.notification.findUniqueOrThrow({
        where: { id: queued.id },
      });
      expect(failed.publishId).not.toBeNull();
      expect(failed.publishNextAttemptAt).not.toBeNull();
      expect(
        createdSchema.parse(await runtime.executeTool(call)).table.id,
      ).toBe(first.table.id);
      expect(publish).toHaveBeenCalledTimes(1);
      expect(
        await dispatchNotificationPublish(
          queued.id,
          new Date(failed.publishNextAttemptAt!.getTime() + 1000),
        ),
      ).toBe("published");
      expect(publish).toHaveBeenCalledTimes(2);
      expect(
        (
          await prisma.notification.findUniqueOrThrow({
            where: { id: queued.id },
          })
        ).publishId,
      ).toBeNull();
      const readAt = new Date();
      await prisma.notification.update({
        where: { id: queued.id },
        data: { isRead: true, readAt },
      });
      await Promise.all([runtime.executeTool(call), runtime.executeTool(call)]);
      expect(publish).toHaveBeenCalledTimes(2);
      expect(
        await prisma.notification.count({ where: { eventId: message.id } }),
      ).toBe(1);
      expect(
        await prisma.notification.findUniqueOrThrow({
          where: { id: queued.id },
        }),
      ).toMatchObject({ isRead: true, readAt, publishId: null });
    });
    it("never replays a failed non-table side effect", async () => {
      const { runtime, request } = await setup(),
        input = { roomId: randomUUID(), content: "Do not send twice" };
      await prisma.sokoBotToolCall.create({
        data: {
          turnId: request.turnId,
          toolCallId: request.toolCallId,
          capability: "post_chat",
          inputHash: actionInputHash(input),
          status: "FAILED",
          disposition: "UNKNOWN",
        },
      });
      await expect(
        runtime.executeTool({ ...request, capability: "post_chat", input }),
      ).rejects.toThrow("outcome is unknown");
      expect(
        await prisma.chatRoomMessage.count({ where: { roomId: input.roomId } }),
      ).toBe(0);
    });
    it("does not steal a currently executing table receipt", async () => {
      const { runtime, request } = await setup(),
        input = createInput();
      await prisma.sokoBotToolCall.create({
        data: {
          turnId: request.turnId,
          toolCallId: request.toolCallId,
          capability: "create_table",
          inputHash: actionInputHash(input),
          status: "PENDING",
        },
      });
      const before = await prisma.dataTable.count({ where: { workspaceId } });
      await expect(
        runtime.executeTool({ ...request, capability: "create_table", input }),
      ).rejects.toThrow("already executing");
      expect(await prisma.dataTable.count({ where: { workspaceId } })).toBe(
        before,
      );
    });
  },
);
