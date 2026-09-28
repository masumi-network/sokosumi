import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  persistHumanMentions: vi.fn(),
  emitHumanMentions: vi.fn(),
  humanMentions: vi.fn(),
  update: vi.fn(),
  find: vi.fn(),
  workspace: vi.fn(),
  bot: vi.fn(),
  message: vi.fn(),
  event: vi.fn(),
  publish: vi.fn(),
  notify: vi.fn(),
  invalidate: vi.fn(),
  taskPublish: vi.fn(),
  taskNotify: vi.fn(),
  archiveRead: vi.fn(),
  calendar: vi.fn(),
  mentions: vi.fn(),
  dispatch: vi.fn(),
  messageUpdate: vi.fn(),
  mentionsUpdate: vi.fn(),
  roomUpdate: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/helpers/chat-human-mentions", () => ({
  persistChatHumanMentions: mocks.persistHumanMentions,
  emitChatHumanMentionNotifications: mocks.emitHumanMentions,
}));
vi.mock("@/helpers/calendar-invalidation", () => ({
  deliverCalendarInvalidationsNow: mocks.calendar,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomUserMention: { findMany: mocks.humanMentions },
    sokoBotEffectOutbox: {
      updateMany: mocks.update,
      findUniqueOrThrow: mocks.find,
    },
    workspace: { findFirst: mocks.workspace },
    sokoBot: { findFirst: mocks.bot },
    chatRoomMessage: {
      findFirst: mocks.message,
      update: mocks.messageUpdate,
      updateMany: mocks.messageUpdate,
    },
    chatRoom: { update: mocks.roomUpdate },
    taskEvent: { findFirst: mocks.event },
    chatRoomMention: {
      findMany: mocks.mentions,
      updateMany: mocks.mentionsUpdate,
    },
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
vi.mock("@/helpers/chat-direct-message-notifications", () => ({
  emitChatDirectMessageNotifications: mocks.notify,
  shouldEmitChatDirectMessageNotifications: () => true,
}));
vi.mock("@/lib/ably/publish", () => ({
  publishTaskEventData: mocks.taskPublish,
}));
vi.mock("@/helpers/task-notifications", () => ({
  notifyTaskStatusEvent: mocks.taskNotify,
  markTaskArchivedRead: mocks.archiveRead,
}));
vi.mock("@/services/chat-room-coworker-dispatch.service", () => ({
  dispatchChatRoomMention: mocks.dispatch,
}));

import prisma from "@/lib/db/prisma";
import { deliverSokoBotEffect } from "./soko-bot-effect-outbox.service";

function effect(overrides = {}) {
  return {
    purpose: "CHAT_MESSAGE",
    status: "PENDING",
    attempts: 1,
    createdAt: new Date(),
    payload: {
      content: "Hello",
      messageId: "message",
      roomId: "room",
      userIds: ["owner"],
      coworkerIds: [],
      botIds: ["bot"],
    },
    receipt: {
      status: "COMPLETED",
      turn: { workspaceId: "workspace", userId: "owner", sokoBotId: "bot" },
    },
    ...overrides,
  };
}
function message(overrides = {}) {
  return {
    id: "message",
    content: "Hello",
    senderSokoBot: { name: "Bot", archivedAt: null },
    room: {
      id: "room",
      name: "Room",
      kind: "direct",
      organizationId: null,
      archivedAt: null,
      userMembers: [{ userId: "owner" }],
      coworkerMembers: [],
      sokoBotMembers: [{ sokoBotId: "bot" }],
    },
    ...overrides,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.humanMentions.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async (callback) => callback(prisma));
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.find.mockResolvedValue(effect());
  mocks.workspace.mockResolvedValue({ id: "workspace" });
  mocks.bot.mockResolvedValue({ id: "bot" });
  mocks.message.mockResolvedValue(message());
  mocks.mentions.mockResolvedValue([]);
});
describe("committed effect outbox", () => {
  it("publishes existing message with strict notifications only after claiming", async () => {
    expect(await deliverSokoBotEffect("effect")).toBe(true);
    expect(mocks.publish).toHaveBeenCalledWith("message", "create", {
      throwOnError: true,
    });
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "message", throwOnError: true }),
    );
    expect(mocks.update.mock.calls.at(-1)?.[0].data.status).toBe("PUBLISHED");
  });
  it("notifies mentioned owner once and sends direct notification only to unmentioned reader", async () => {
    const record = effect();
    mocks.find.mockResolvedValue({
      ...record,
      payload: { ...record.payload, userIds: ["owner", "reader"] },
    });
    const current = message();
    current.room.userMembers.push({ userId: "reader" });
    mocks.message.mockResolvedValue(current);
    mocks.humanMentions.mockResolvedValue([{ userId: "owner" }]);
    expect(await deliverSokoBotEffect("effect")).toBe(true);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserIds: ["reader"],
        throwOnError: true,
      }),
    );
    expect(mocks.emitHumanMentions).toHaveBeenCalledWith({
      messageId: "message",
      mentionedUserIds: ["owner"],
      throwOnError: true,
    });
  });

  it("does not publish after losing its lease during authority checks", async () => {
    mocks.update
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    expect(await deliverSokoBotEffect("effect")).toBe(false);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it.each(["workspace", "bot"] as const)(
    "suppresses revoked %s authority",
    async (key) => {
      mocks[key].mockResolvedValue(null);
      expect(await deliverSokoBotEffect("effect")).toBe(false);
      expect(mocks.publish).not.toHaveBeenCalled();
      expect(mocks.update.mock.calls.at(-1)?.[0].data).toMatchObject({
        status: "SUPPRESSED",
        reason: "AUTHORITY_REVOKED",
      });
    },
  );
  it("suppresses changed audience rather than redirecting", async () => {
    const current = message();
    current.room.userMembers.push({ userId: "new-reader" });
    mocks.message.mockResolvedValue(current);
    expect(await deliverSokoBotEffect("effect")).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.persistHumanMentions).not.toHaveBeenCalled();
    expect(mocks.emitHumanMentions).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls.at(-1)?.[0].data.reason).toBe(
      "AUDIENCE_CHANGED",
    );
  });
  it.each(["publish", "notify", "invalidate", "emitHumanMentions"] as const)(
    "retains obligation when %s fails and retries same message",
    async (key) => {
      mocks[key].mockRejectedValueOnce(new Error("offline"));
      expect(await deliverSokoBotEffect("effect")).toBe(false);
      expect(mocks.update.mock.calls.at(-1)?.[0].data).toMatchObject({
        lastErrorCategory: "EFFECT_PUBLICATION_FAILED",
        leaseToken: null,
      });
      expect(await deliverSokoBotEffect("effect")).toBe(true);
      expect(mocks.publish).toHaveBeenLastCalledWith("message", "create", {
        throwOnError: true,
      });
    },
  );
  it("dead letters exhausted publication without exposing error contents", async () => {
    mocks.find.mockResolvedValue(
      effect({ createdAt: new Date(Date.now() - 90_000_000) }),
    );
    mocks.publish.mockRejectedValue(new Error("private provider response"));
    await deliverSokoBotEffect("effect");
    expect(mocks.update.mock.calls.at(-1)?.[0].data).toMatchObject({
      status: "DEAD_LETTER",
      reason: "RETRY_EXHAUSTED",
    });
    expect(JSON.stringify(mocks.update.mock.calls)).not.toContain(
      "private provider response",
    );
  });
  it("hands an archived task's reader cleanup and calendar effects to main helpers", async () => {
    const record = effect({
      purpose: "TASK_EVENT",
      payload: { taskId: "task", eventId: "event" },
    });
    mocks.find.mockResolvedValue({
      ...record,
      receipt: { ...record.receipt, capability: "archive_task" },
    });
    const task = {
      id: "task",
      ownerId: "owner",
      assigneeUserId: null,
      archivedAt: new Date(),
    };
    mocks.event.mockResolvedValue({
      id: "event",
      taskId: "task",
      status: null,
      task,
    });
    expect(await deliverSokoBotEffect("effect")).toBe(true);
    expect(mocks.calendar).toHaveBeenCalledWith("workspace");
    expect(mocks.archiveRead).toHaveBeenCalledWith(task);
    expect(mocks.taskNotify).not.toHaveBeenCalled();
  });

  it("retries task notification failures using the same committed event", async () => {
    mocks.find.mockResolvedValue(
      effect({
        purpose: "TASK_EVENT",
        payload: { taskId: "task", eventId: "event" },
      }),
    );
    mocks.event.mockResolvedValue({
      id: "event",
      taskId: "task",
      status: "COMPLETED",
      task: { ownerId: "owner" },
    });
    mocks.taskNotify.mockRejectedValueOnce(new Error("offline"));
    expect(await deliverSokoBotEffect("effect")).toBe(false);
    expect(await deliverSokoBotEffect("effect")).toBe(true);
    expect(mocks.taskNotify).toHaveBeenLastCalledWith(
      "task",
      "event",
      "COMPLETED",
      null,
      { throwOnError: true },
    );
  });
});
