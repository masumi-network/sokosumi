import { createHash, randomUUID } from "node:crypto";
import { CHAT_MENTION_MESSAGE_KEY } from "@sokosumi/utils";
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
import * as notificationsModule from "@/helpers/notifications";
import {
  publishChatRoomsChanged,
  publishNotificationEvent,
} from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import * as effectsModule from "@/lib/soko-bot/chat-message-effects";
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
const capabilities = [
  "create_table",
  "write_table_rows",
  "update_table_columns",
] as const;

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

async function drainPending(pending: Promise<unknown>[]) {
  while (pending.length > 0) {
    await Promise.all(pending.splice(0));
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
      await drainPending(pending);
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
          userId,
          workspaceId,
          sokoBotId,
          source: "CHAT",
          status: "RUNNING",
          leaseExpiresAt: new Date(Date.now() + 600000),
          clientTurnId: randomUUID(),
          userMessage: "Research",
          capabilityNames: [...capabilities],
          deadlineAt: new Date(Date.now() + 600000),
          eveSessionId: randomUUID(),
        },
      });
      const authorized: AuthorizedSokoBotRuntime = {
        turn,
        classificationConfidence: 1,
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
          capabilities: [...capabilities],
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
    const createdSchema = z.object({
      table: z.object({
        id: z.uuid(),
        columns: z.array(z.object({ id: z.uuid() })),
      }),
      url: z.string(),
    });
    function createInput() {
      return {
        key: randomUUID(),
        title: "Recovery",
        columns: [{ id: randomUUID(), name: "Company", type: "text" }],
      };
    }
    it.each(capabilities)(
      "recovers %s after receipt failure without duplicate changes",
      async (capability) => {
        const { runtime, authorize, request } = await setup();
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
        const receipt = vi
          .spyOn(prisma.sokoBotToolCall, "update")
          .mockRejectedValueOnce(new Error("receipt interrupted"));
        await expect(runtime.executeTool(call)).rejects.toThrow(
          "receipt interrupted",
        );
        receipt.mockRestore();
        const where = {
          turnId_toolCallId: {
            turnId: request.turnId,
            toolCallId: request.toolCallId,
          },
        };
        expect(
          (await prisma.sokoBotToolCall.findUniqueOrThrow({ where })).status,
        ).toBe("FAILED");
        const counts = async () => [
          await prisma.dataTable.count({ where: { workspaceId } }),
          await prisma.tableRow.count({ where: { tableId: initial.table.id } }),
          await prisma.tableChange.count({
            where: { tableId: initial.table.id },
          }),
        ];
        const before = await counts();
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
        const result = await runtime.executeTool(call);
        expect(await runtime.executeTool(call)).toEqual(result);
        expect(await counts()).toEqual(before);
        expect(
          (await prisma.sokoBotToolCall.findUniqueOrThrow({ where })).status,
        ).toBe("COMPLETED");
        if (capability === "create_table") {
          const recovered = createdSchema.parse(result);
          expect(recovered.url).toBe(`/drive/tables/${recovered.table.id}`);
          expect(
            await prisma.dataTable.findUnique({
              where: { id: recovered.table.id },
            }),
          ).not.toBeNull();
        } else if (capability === "write_table_rows") {
          const recovered = z
            .object({
              batchId: z.uuid(),
              rows: z.array(z.object({ id: z.uuid() })),
            })
            .parse(result);
          expect(
            await prisma.tableRow.findUnique({
              where: { id: recovered.rows[0].id },
            }),
          ).not.toBeNull();
          expect(recovered.rows).toHaveLength(1);
        } else {
          expect(result).toMatchObject({
            id: initial.table.id,
            version: 2,
            columns: [expect.objectContaining({ name: "Renamed" })],
          });
        }
      },
    );
    it.each([false, true])(
      "recovers publication failure (already published: %s)",
      async (published) => {
        const { runtime, request, turn } = await setup();
        const room = await prisma.chatRoom.create({
          data: {
            name: "Recovery",
            kind: "direct",
            createdByUserId: userId,
            directKey: randomUUID(),
          },
        });
        const message = await prisma.chatRoomMessage.create({
          data: { roomId: room.id, content: "Research", senderUserId: userId },
        });
        const mention = await prisma.chatRoomMention.create({
          data: { messageId: message.id, sokoBotId },
        });
        await prisma.sokoBotTurn.update({
          where: { id: turn.id },
          data: { chatMentionId: mention.id },
        });
        await prisma.chatRoomSokoBotMember.create({
          data: { roomId: room.id, sokoBotId },
        });
        const originalPost = runtime["postChat"].bind(runtime);
        let first = true;
        vi.spyOn(runtime, "postChat").mockImplementation(async (...args) => {
          if (first && !published) {
            first = false;
            throw Error("publication interrupted");
          }
          const result = await originalPost(...args);
          if (first) {
            first = false;
            throw Error("publication interrupted");
          }
          return result;
        });
        const call = {
          ...request,
          capability: "create_table" as const,
          input: createInput(),
        };
        await expect(runtime.executeTool(call)).rejects.toThrow(
          "publication interrupted",
        );
        const count = await prisma.dataTable.count({ where: { workspaceId } });
        const result = createdSchema.parse(await runtime.executeTool(call));
        expect(await prisma.dataTable.count({ where: { workspaceId } })).toBe(
          count,
        );
        const links = await prisma.chatRoomMessage.findMany({
          where: { roomId: room.id, senderSokoBotId: sokoBotId },
        });
        expect(links).toHaveLength(1);
        expect(links[0].content).toContain(result.url);
        expect(
          await prisma.dataTable.findUnique({ where: { id: result.table.id } }),
        ).not.toBeNull();
      },
    );
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
      if (!roomId)
        await prisma.chatRoomSokoBotMember.create({
          data: { roomId: room.id, sokoBotId },
        });
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
    it.each([
      { destination: "chat", separateTurns: false },
      { destination: "task", separateTurns: false },
      { destination: "chat", separateTurns: true },
      { destination: "task", separateTurns: true },
    ])(
      "R3: concurrent distinct calls publish one $destination reference (separate turns: $separateTurns)",
      async ({ destination, separateTurns }) => {
        const { runtime, request, turn, authorized } = await setup();
        const other = separateTurns
          ? await setup()
          : { runtime: new SokoBotRuntimeService(), request, turn };
        const otherRuntime = other.runtime;
        if (!separateTurns)
          vi.spyOn(otherRuntime, "authorize").mockResolvedValue(authorized);
        const destinationId =
          destination === "chat"
            ? await chatDestination(turn.id)
            : await taskDestination();
        if (destination === "chat" && separateTurns)
          await chatDestination(other.turn.id, destinationId);
        const input = {
          ...createInput(),
          ...(destination === "task" && { taskId: destinationId }),
        };
        let entered = 0;
        let unblock!: () => void;
        const barrier = new Promise<void>((resolve) => {
          unblock = resolve;
        });
        // Synchronize the actual adapters after the old caller's lookup, then
        // execute their real Prisma transactions from independent runtime instances.
        for (const service of [runtime, otherRuntime]) {
          if (destination === "chat") {
            const post = service["postChat"].bind(service);
            vi.spyOn(service, "postChat").mockImplementation(
              async (...args) => {
                if (++entered === 2) unblock();
                await barrier;
                return post(...args);
              },
            );
          } else {
            const reply = service["replyToTask"].bind(service);
            vi.spyOn(service, "replyToTask").mockImplementation(
              async (...args) => {
                if (++entered === 2) unblock();
                await barrier;
                return reply(...args);
              },
            );
          }
        }
        const before = await prisma.dataTable.count({ where: { workspaceId } });
        const results = await Promise.all(
          [runtime, otherRuntime].map((service, index) =>
            service.executeTool({
              ...(index ? other.request : request),
              toolCallId: `concurrent-${index}`,
              capability: "create_table",
              input,
            }),
          ),
        );
        expect(results[0]).toEqual(results[1]);
        expect(await prisma.dataTable.count({ where: { workspaceId } })).toBe(
          before + 1,
        );
        const result = createdSchema.parse(results[0]);
        if (destination === "chat") {
          const links = await prisma.chatRoomMessage.findMany({
            where: { roomId: destinationId, senderSokoBotId: sokoBotId },
          });
          expect(links).toHaveLength(1);
          expect(links[0].content).toContain(result.url);
        } else {
          const links = await prisma.taskEvent.findMany({
            where: { taskId: destinationId, sokoBotId },
          });
          expect(links).toHaveLength(1);
          expect(links[0].comment).toContain(result.url);
          expect(
            await prisma.sokoBotDelegation.count({
              where: { taskId: destinationId },
            }),
          ).toBe(1);
        }
        expect(
          await runtime.executeTool({
            ...request,
            toolCallId: "concurrent-0",
            capability: "create_table",
            input,
          }),
        ).toEqual(results[0]);
        const count =
          destination === "chat"
            ? await prisma.chatRoomMessage.count({
                where: { roomId: destinationId, senderSokoBotId: sokoBotId },
              })
            : await prisma.taskEvent.count({
                where: { taskId: destinationId, sokoBotId },
              });
        expect(count).toBe(1);
      },
    );
    it.each([false, true])(
      "R3: task publication recovers before/after persistence (committed: %s)",
      async (committed) => {
        const { runtime, request } = await setup();
        const taskId = await taskDestination();
        const original = runtime["replyToTask"].bind(runtime);
        let first = true;
        vi.spyOn(runtime, "replyToTask").mockImplementation(async (...args) => {
          if (first && !committed) {
            first = false;
            throw Error("publication interrupted");
          }
          const result = await original(...args);
          if (first) {
            first = false;
            throw Error("publication interrupted");
          }
          return result;
        });
        const call = {
          ...request,
          capability: "create_table" as const,
          input: { ...createInput(), taskId },
        };
        await expect(runtime.executeTool(call)).rejects.toThrow(
          "publication interrupted",
        );
        const recovered = await runtime.executeTool({
          ...call,
          toolCallId: randomUUID(),
        });
        expect(await runtime.executeTool(call)).toEqual(recovered);
        const result = createdSchema.parse(recovered);
        const events = await prisma.taskEvent.findMany({
          where: { taskId, sokoBotId },
        });
        expect(events).toHaveLength(1);
        expect(events[0].comment).toContain(result.url);
        expect(
          await prisma.sokoBotDelegation.count({ where: { taskId } }),
        ).toBe(1);
      },
    );
    it("R3: chat publication is isolated by table and destination, with fresh membership checks", async () => {
      const first = await setup(),
        second = await setup();
      const a = await chatDestination(first.turn.id),
        b = await chatDestination(second.turn.id);
      const input = createInput();
      const call = {
        ...first.request,
        capability: "create_table" as const,
        input,
      };
      const result = await first.runtime.executeTool(call);
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
      const aLinks = await prisma.chatRoomMessage.findMany({
        where: { roomId: a, senderSokoBotId: sokoBotId },
      });
      const bLinks = await prisma.chatRoomMessage.findMany({
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
      await prisma.chatRoomSokoBotMember.deleteMany({
        where: { roomId: a, sokoBotId },
      });
      await expect(first.runtime.executeTool(call)).rejects.toThrow(
        "not a member",
      );
      expect(
        await prisma.chatRoomMessage.count({
          where: { roomId: a, senderSokoBotId: sokoBotId },
        }),
      ).toBe(2);
    });
    it("R3: task publication cannot cross changed task authority or replay a terminal task", async () => {
      const { runtime, request } = await setup();
      const a = await taskDestination(),
        b = await taskDestination();
      const input = { ...createInput(), taskId: a };
      const call = { ...request, capability: "create_table" as const, input };
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
    it.each(["FAILED", "PENDING"] as const)(
      "R4: post-commit interruption recovers a %s receipt, link and deduplicated direct notification",
      async (receiptStatus) => {
        const { runtime, request, turn } = await setup();
        const roomId = await chatDestination(turn.id);
        const effects = vi.spyOn(
          effectsModule,
          "scheduleSokoBotChatMessageEffects",
        );
        vi.mocked(publishChatRoomsChanged).mockClear();
        vi.mocked(publishNotificationEvent).mockClear();
        await prisma.chatRoomUserMember.create({ data: { roomId, userId } });
        // This exception models interruption at the post-commit boundary.
        // Production realtime helpers catch ordinary provider errors.
        vi.mocked(publishChatRoomMessageRealtimeById).mockRejectedValueOnce(
          new Error("execution interrupted after message commit"),
        );
        const call = {
          ...request,
          capability: "create_table" as const,
          input: createInput(),
        };
        await expect(runtime.executeTool(call)).rejects.toThrow(
          "execution interrupted after message commit",
        );
        const before = await prisma.chatRoomMessage.findMany({
          where: { roomId, senderSokoBotId: sokoBotId },
        });
        expect(before).toHaveLength(1);
        expect(effects).not.toHaveBeenCalled();
        expect(
          await prisma.sokoBotToolCall.findUniqueOrThrow({
            where: {
              turnId_toolCallId: {
                turnId: request.turnId,
                toolCallId: request.toolCallId,
              },
            },
          }),
        ).toMatchObject({ status: "FAILED" });
        if (receiptStatus === "PENDING") {
          // Termination would bypass executeTool's catch; reconstruct its stale lease.
          await prisma.sokoBotToolCall.update({
            where: {
              turnId_toolCallId: {
                turnId: request.turnId,
                toolCallId: request.toolCallId,
              },
            },
            data: { status: "PENDING", updatedAt: new Date(0) },
          });
        }
        const result = createdSchema.parse(await runtime.executeTool(call));
        expect(
          await prisma.chatRoomMessage.findMany({
            where: { roomId, senderSokoBotId: sokoBotId },
          }),
        ).toEqual(before);
        await drainPending(pending);
        expect(effects).toHaveBeenCalledTimes(1);
        expect(publishChatRoomsChanged).toHaveBeenCalledTimes(1);
        const notifications = await prisma.notification.findMany({
          where: { userId, eventId: before[0].id },
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
        await drainPending(pending);
        const replayedNotifications = await prisma.notification.findMany({
          where: { userId, eventId: before[0].id },
        });
        expect(replayedNotifications).toHaveLength(1);
        expect(replayedNotifications[0]).toMatchObject({
          id: notifications[0].id,
          isRead: true,
          readAt,
        });
        expect(replayedNotifications[0].publishId).toBeNull();
        expect(publishNotificationEvent).toHaveBeenCalledTimes(1);
        expect(publishChatRoomsChanged).toHaveBeenCalledTimes(3);
        expect(
          await prisma.sokoBotToolCall.findUniqueOrThrow({
            where: {
              turnId_toolCallId: {
                turnId: request.turnId,
                toolCallId: request.toolCallId,
              },
            },
          }),
        ).toMatchObject({ status: "COMPLETED" });
        expect(before[0].content).toContain(result.url);
        expect(publishChatRoomMessageRealtimeById).toHaveBeenLastCalledWith(
          before[0].id,
          "create",
        );
      },
    );
    it.each([false, true])(
      "R4: @all table publication preserves one human mention notification across replay (interrupted: %s)",
      async (interrupted) => {
        const { runtime, request, turn } = await setup();
        const roomId = await chatDestination(turn.id);
        await prisma.chatRoomUserMember.create({ data: { roomId, userId } });
        const call = {
          ...request,
          capability: "create_table" as const,
          input: { ...createInput(), title: "Recovery @all now" },
        };
        if (interrupted) {
          vi.mocked(publishChatRoomMessageRealtimeById).mockRejectedValueOnce(
            new Error("interrupted before mention effects"),
          );
          await expect(runtime.executeTool(call)).rejects.toThrow(
            "interrupted before mention effects",
          );
        } else {
          await runtime.executeTool(call);
        }
        await drainPending(pending);
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
        await drainPending(pending);
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
        await drainPending(pending);
        expect(
          await prisma.notification.findMany({
            where: { eventId: message.id },
          }),
        ).toEqual([
          expect.objectContaining({
            id: rows[0].id,
            messageKey: CHAT_MENTION_MESSAGE_KEY,
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
    it("R4: notification persistence failure before commit is recovered by the next table retry", async () => {
      const { runtime, request, turn } = await setup();
      const roomId = await chatDestination(turn.id);
      await prisma.chatRoomUserMember.create({ data: { roomId, userId } });
      vi.mocked(publishNotificationEvent).mockClear();
      const call = {
        ...request,
        capability: "create_table" as const,
        input: createInput(),
      };
      const create = vi
        .spyOn(notificationsModule, "createNotification")
        .mockRejectedValueOnce(new Error("notification write interrupted"));
      const first = createdSchema.parse(await runtime.executeTool(call));
      await drainPending(pending);
      const message = await prisma.chatRoomMessage.findFirstOrThrow({
        where: { roomId, senderSokoBotId: sokoBotId },
      });
      expect(
        await prisma.notification.count({ where: { eventId: message.id } }),
      ).toBe(0);
      expect(create).toHaveBeenCalledTimes(1);
      expect(publishNotificationEvent).not.toHaveBeenCalled();
      create.mockRestore();
      const recovered = createdSchema.parse(await runtime.executeTool(call));
      await drainPending(pending);
      expect(recovered.table.id).toBe(first.table.id);
      const notifications = await prisma.notification.findMany({
        where: { eventId: message.id },
      });
      expect(notifications).toHaveLength(1);
      await publishQueuedNotification(notifications[0].id);
      expect(publishNotificationEvent).toHaveBeenCalledTimes(1);
    });
    it("R4: committed notification delivery retries through the bounded publisher", async () => {
      const { runtime, request, turn } = await setup();
      const roomId = await chatDestination(turn.id);
      await prisma.chatRoomUserMember.create({ data: { roomId, userId } });
      const call = {
        ...request,
        capability: "create_table" as const,
        input: createInput(),
      };
      const publish = vi.mocked(publishNotificationEvent);
      publish.mockRejectedValueOnce(new Error("provider unavailable"));
      const first = createdSchema.parse(await runtime.executeTool(call));
      await drainPending(pending);
      const message = await prisma.chatRoomMessage.findFirstOrThrow({
        where: { roomId, senderSokoBotId: sokoBotId },
      });
      const queued = await prisma.notification.findFirstOrThrow({
        where: { eventId: message.id },
      });
      // A dispatch raced with commit may not yet have reached the provider.
      if (publish.mock.calls.length === 0) {
        expect(await dispatchNotificationPublish(queued.id, new Date())).toBe(
          "pending",
        );
      }
      expect(publish).toHaveBeenCalledTimes(1);
      const failed = await prisma.notification.findUniqueOrThrow({
        where: { id: queued.id },
      });
      expect(failed.publishId).toBe(queued.publishId);
      expect(failed.publishId).not.toBeNull();
      expect(failed.publishNextAttemptAt).not.toBeNull();
      const recovered = createdSchema.parse(await runtime.executeTool(call));
      await drainPending(pending);
      expect(recovered.table.id).toBe(first.table.id);
      expect(publish).toHaveBeenCalledTimes(1);
      const secondAttempt = await dispatchNotificationPublish(
        queued.id,
        new Date(failed.publishNextAttemptAt!.getTime() + 1_000),
      );
      expect(secondAttempt).toBe("published");
      expect(publish).toHaveBeenCalledTimes(2);
      const delivered = await prisma.notification.findUniqueOrThrow({
        where: { id: queued.id },
      });
      expect(delivered.publishId).toBeNull();
      const readAt = new Date();
      await prisma.notification.update({
        where: { id: queued.id },
        data: { isRead: true, readAt },
      });
      await Promise.all([runtime.executeTool(call), runtime.executeTool(call)]);
      await drainPending(pending);
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
      const { runtime, request } = await setup();
      const input = { roomId: randomUUID(), content: "Do not send twice" };
      await prisma.sokoBotToolCall.create({
        data: {
          turnId: request.turnId,
          toolCallId: request.toolCallId,
          capability: "post_chat",
          inputHash: createHash("sha256")
            .update(JSON.stringify(input))
            .digest("hex"),
          status: "FAILED",
        },
      });
      const post = vi.spyOn(runtime, "postChat");
      await expect(
        runtime.executeTool({ ...request, capability: "post_chat", input }),
      ).rejects.toThrow("previously failed");
      expect(post).not.toHaveBeenCalled();
    });
    it("does not steal a currently executing table receipt", async () => {
      const { runtime, request } = await setup();
      const input = createInput();
      await prisma.sokoBotToolCall.create({
        data: {
          turnId: request.turnId,
          toolCallId: request.toolCallId,
          capability: "create_table",
          inputHash: createHash("sha256")
            .update(JSON.stringify(input))
            .digest("hex"),
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
