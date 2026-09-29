import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  persistHumanMentions: vi.fn(),
  emitHumanMentions: vi.fn(),
  humanMentions: vi.fn(),
  claim: vi.fn(),
  find: vi.fn(),
  findOwned: vi.fn(),
  update: vi.fn(),
  upsertDelivery: vi.fn(),
  turn: vi.fn(),
  bot: vi.fn(),
  workspace: vi.fn(),
  room: vi.fn(),
  message: vi.fn(),
  roomUpdate: vi.fn(),
  publish: vi.fn(),
  invalidate: vi.fn(),
  persistChat: vi.fn(),
  storedContent: vi.fn(),
  nudge: vi.fn(),
  messageFind: vi.fn(),
  transaction: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  effects: vi.fn(),
  deliverEffect: vi.fn(),
}));
vi.mock("@/helpers/chat-human-mentions", () => ({
  persistChatHumanMentions: mocks.persistHumanMentions,
  emitChatHumanMentionNotifications: mocks.emitHumanMentions,
}));
vi.mock("@/helpers/calendar-invalidation", () => ({
  deliverCalendarInvalidationsNow: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomUserMention: { findMany: mocks.humanMentions },
    sokoBotDelivery: {
      updateMany: mocks.claim,
      findUniqueOrThrow: mocks.find,
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
      findFirst: mocks.findOwned,
      update: mocks.update,
      upsert: mocks.upsertDelivery,
    },
    sokoBotEffectOutbox: { findMany: mocks.effects },
    sokoBotTurn: { findUniqueOrThrow: mocks.turn },
    sokoBot: { findFirst: mocks.bot },
    workspace: { findFirst: mocks.workspace },
    chatRoom: { findFirst: mocks.room, update: mocks.roomUpdate },
    chatRoomMessage: {
      upsert: mocks.message,
      findFirst: mocks.messageFind,
      findUniqueOrThrow: mocks.storedContent,
    },
    sokoBotNudge: { updateMany: mocks.nudge },
  },
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: mocks.transaction,
}));
vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: mocks.publish,
}));
vi.mock("@/helpers/chat-room-message-created-effects", () => ({
  invalidateChatRoomMessageReaders: mocks.invalidate,
}));
vi.mock("./soko-bot-effect-outbox.service", () => ({
  deliverSokoBotEffect: mocks.deliverEffect,
}));
vi.mock("./soko-bot-chat.service", () => ({
  persistSokoBotChatTurn: mocks.persistChat,
}));

import prisma from "@/lib/db/prisma";
import {
  deliverSokoBotDelivery,
  deliverSokoBotTurnOutbox,
  enqueueSokoBotDelivery,
  syncSokoBotDeliveries,
} from "./soko-bot-delivery.service";

function turn(overrides = {}) {
  return {
    id: "turn",
    source: "SCHEDULE",
    status: "COMPLETED",
    sokoBotId: "bot",
    userId: "owner",
    workspaceId: "workspace",
    destinationRoomId: "room",
    destinationAudience: {
      userIds: ["owner"],
      coworkerIds: [],
      botIds: ["bot"],
    },
    finalAnswer: "Saved result",
    chatResponseMessageId: null,
    chatMentionId: null,
    chainDepth: 0,
    ...overrides,
  };
}
function delivery(overrides = {}) {
  return {
    id: "delivery",
    turnId: "turn",
    roomId: "room",
    status: "PENDING",
    messageId: null,
    purpose: "FINAL",
    destinationId: "room",
    attempts: 1,
    createdAt: new Date(),
    turn: turn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.humanMentions.mockResolvedValue([]);
  mocks.storedContent.mockResolvedValue({ content: "Saved result" });
  mocks.transaction.mockImplementation(async (callback) => callback(prisma));
  mocks.claim.mockResolvedValue({ count: 1 });
  mocks.find.mockResolvedValue(delivery());
  mocks.findOwned.mockResolvedValue(delivery());
  mocks.turn.mockResolvedValue(turn());
  mocks.bot.mockResolvedValue({ id: "bot" });
  mocks.workspace.mockResolvedValue({ id: "workspace" });
  mocks.room.mockResolvedValue({
    id: "room",
    userMembers: [{ userId: "owner" }],
    coworkerMembers: [],
    sokoBotMembers: [{ sokoBotId: "bot" }],
  });
  mocks.message.mockResolvedValue({ id: "message" });
  mocks.update.mockResolvedValue(
    delivery({ status: "PERSISTED", messageId: "message" }),
  );
  mocks.messageFind.mockResolvedValue({ id: "placeholder" });
});

describe("durable delivery", () => {
  it("kicks committed turn delivery and effects without waiting for cron", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "delivery" },
      { id: "delivery-2" },
    ]);
    mocks.effects.mockResolvedValue([{ id: "effect" }]);
    await deliverSokoBotTurnOutbox("turn");
    expect(mocks.publish).toHaveBeenCalledWith("message", "create", {
      throwOnError: true,
    });
    expect(mocks.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "delivery-2" }),
      }),
    );
    expect(mocks.deliverEffect).toHaveBeenCalledWith("effect");
    expect(mocks.effects).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          receipt: { turnId: "turn" },
          status: { in: ["PENDING", "PERSISTED"] },
        },
      }),
    );
  });

  it("drains multiple batches while the sync budget remains", async () => {
    mocks.findMany
      .mockResolvedValueOnce(
        Array.from({ length: 20 }, (_, index) => ({ id: `delivery-${index}` })),
      )
      .mockResolvedValueOnce([{ id: "delivery-20" }]);
    expect(
      await syncSokoBotDeliveries({
        shouldContinue: () => true,
        abortSignal: new AbortController().signal,
      }),
    ).toBe(21);
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
  });

  it("enqueues in the caller's transaction with an immutable destination", async () => {
    await enqueueSokoBotDelivery(prisma, "turn");
    expect(mocks.upsertDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          turnId_destinationKind_destinationId_purpose: {
            turnId: "turn",
            destinationKind: "CHAT_ROOM",
            destinationId: "room",
            purpose: "FINAL",
          },
        },
        create: expect.objectContaining({ roomId: "room", status: "PENDING" }),
        update: {},
      }),
    );
  });

  it.each([
    [{ destinationRoomId: null }, "NO_DESTINATION"],
    [{ finalAnswer: "" }, "SILENT"],
    [{ status: "CANCELLED" }, "CANCELLED"],
  ])(
    "records suppression instead of losing an obligation: %s",
    async (overrides, reason) => {
      mocks.turn.mockResolvedValue(turn(overrides));
      await enqueueSokoBotDelivery(prisma, "turn");
      expect(mocks.upsertDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: "SUPPRESSED", reason }),
        }),
      );
      expect(mocks.room).not.toHaveBeenCalled();
      expect(mocks.nudge).toHaveBeenCalledWith({
        where: { pendingTurnId: "turn" },
        data: { pendingTurnId: null, nextCheckAt: expect.any(Date) },
      });
      expect(mocks.nudge.mock.calls[0]?.[0].data).not.toHaveProperty(
        "lastDeliveredAt",
      );
    },
  );

  it("creates one stable keyed message and records PERSISTED before transport", async () => {
    mocks.publish.mockImplementation(async () => {
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "PERSISTED", messageId: "message" },
        }),
      );
    });
    expect(await deliverSokoBotDelivery("delivery")).toBe(true);
    expect(mocks.message).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roomId_clientMessageId: {
            roomId: "room",
            clientMessageId: "soko-bot:turn:final",
          },
        },
        update: {},
      }),
    );
    expect(mocks.publish).toHaveBeenCalledWith("message", "create", {
      throwOnError: true,
    });
  });

  it("retries publication after a crash without touching persisted content", async () => {
    mocks.find.mockResolvedValue(
      delivery({ status: "PERSISTED", messageId: "message" }),
    );
    await deliverSokoBotDelivery("delivery");
    expect(mocks.message).not.toHaveBeenCalled();
    expect(mocks.persistChat).not.toHaveBeenCalled();
    expect(mocks.publish).toHaveBeenCalledWith("message", "create", {
      throwOnError: true,
    });
  });

  it("a competing or stale worker cannot persist or publish", async () => {
    mocks.claim
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    expect(await deliverSokoBotDelivery("delivery")).toBe(false);
    expect(mocks.message).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("does not publish if its lease expires after message persistence", async () => {
    mocks.claim
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    expect(await deliverSokoBotDelivery("delivery")).toBe(false);
    expect(mocks.message).toHaveBeenCalledOnce();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("revocation suppresses a delivery without selecting a replacement room", async () => {
    mocks.room.mockResolvedValue(null);
    await deliverSokoBotDelivery("delivery");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SUPPRESSED",
          reason: "DESTINATION_REVOKED",
        }),
      }),
    );
    expect(mocks.room).toHaveBeenCalledOnce();
    expect(mocks.message).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("suppresses newly shared rooms even when bot and owner remain members", async () => {
    mocks.room.mockResolvedValue({
      id: "room",
      userMembers: [{ userId: "owner" }, { userId: "new-reader" }],
      coworkerMembers: [],
      sokoBotMembers: [{ sokoBotId: "bot" }],
    });
    await deliverSokoBotDelivery("delivery");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUPPRESSED" }),
      }),
    );
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("revoked workspace membership suppresses even with the chat roster intact", async () => {
    mocks.workspace.mockResolvedValue(null);
    await deliverSokoBotDelivery("delivery");
    expect(mocks.persistHumanMentions).not.toHaveBeenCalled();
    expect(mocks.emitHumanMentions).not.toHaveBeenCalled();
    expect(mocks.message).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUPPRESSED" }),
      }),
    );
  });

  it("transport failure retains PERSISTED and schedules bounded retry", async () => {
    mocks.publish.mockRejectedValue(new Error("offline"));
    mocks.findOwned.mockResolvedValue(
      delivery({ status: "PERSISTED", messageId: "message" }),
    );
    await deliverSokoBotDelivery("delivery");
    const retry = mocks.claim.mock.calls.at(-1)?.[0];
    expect(retry.data.lastErrorCategory).toBe("TRANSPORT_FAILED");
    expect(retry.data).not.toHaveProperty("status");
    expect(retry.data.nextAttemptAt.getTime()).toBeGreaterThan(
      Date.now() + 59_000,
    );
    expect(retry.where.leaseToken).toEqual(expect.any(String));
  });

  it("dead-letters after 24 hours without rerunning inference", async () => {
    mocks.publish.mockRejectedValue(new Error("offline"));
    mocks.findOwned.mockResolvedValue(
      delivery({ createdAt: new Date(Date.now() - 25 * 60 * 60_000) }),
    );
    await deliverSokoBotDelivery("delivery");
    expect(mocks.claim.mock.calls.at(-1)?.[0].data).toMatchObject({
      status: "DEAD_LETTER",
      reason: "RETRY_EXHAUSTED",
    });
  });
});
