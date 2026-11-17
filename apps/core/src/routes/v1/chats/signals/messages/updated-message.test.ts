import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMembersMock, pending, publishChangedMock, publishMessageMock } =
  vi.hoisted(() => ({
    findMembersMock: vi.fn(),
    pending: [] as Promise<unknown>[],
    publishChangedMock: vi.fn(),
    publishMessageMock: vi.fn(),
  }));

const MESSAGE = {
  id: "00000000-0000-4000-8000-000000000002",
  roomId: "00000000-0000-4000-8000-000000000001",
  content: "Alice, can you send the pricing sheet?",
};

vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  waitUntil: (work: Promise<unknown>) => pending.push(work),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomMessage: { findUniqueOrThrow: vi.fn(async () => MESSAGE) },
    chatRoomUserMember: { findMany: findMembersMock },
  },
}));
vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: publishMessageMock,
}));
vi.mock("@/lib/ably/publish", () => ({
  publishChatRoomsChanged: publishChangedMock,
}));
vi.mock("@/routes/v1/chats/rooms/helpers", () => ({
  chatRoomMessageInclude: {},
  mapChatRoomMessage: (message: unknown) => message,
  withChatRoomReplyCount: async (_db: unknown, message: unknown) => message,
}));
vi.mock("@/schemas/chat-room.schema", () => ({
  chatRoomMessageSchema: { parse: (message: unknown) => message },
}));

import { coreEvlogMiddleware } from "@/lib/evlog";
import {
  expectBackgroundProbe,
  probeBackgroundFailure,
} from "@/test/background-probe";
import { expectCoreLog } from "@/test/core-log";
import { answerWithUpdatedMessage } from "./updated-message";

function answer() {
  const app = new Hono();
  app.use("*", coreEvlogMiddleware());
  app.put("/", async (c) =>
    c.json(await answerWithUpdatedMessage(MESSAGE.id, "user-1")),
  );
  return app.request("/", { method: "PUT" });
}

describe("answerWithUpdatedMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pending.length = 0;
    publishMessageMock.mockResolvedValue(undefined);
    publishChangedMock.mockResolvedValue(undefined);
    findMembersMock.mockResolvedValue([{ userId: "user-1" }]);
  });

  it("announces the change as background work, off the request's event", async () => {
    expectBackgroundProbe("publishChatRoomMessageRealtime");
    publishMessageMock.mockImplementationOnce(async () => {
      probeBackgroundFailure("publishChatRoomMessageRealtime");
    });

    const response = await answer();
    await Promise.all(pending);

    expect(response.status).toBe(200);
  });

  it("logs a failed announcement on its own event without the message's text", async () => {
    const errors = expectCoreLog(
      "error",
      "Could not announce a chat signal change",
    );
    // A publish error can quote the payload, which is the message itself.
    publishMessageMock.mockRejectedValueOnce(
      new Error(`Payload rejected: ${MESSAGE.content}`),
    );

    const response = await answer();
    await Promise.all(pending);

    expect(response.status).toBe(200);
    expect(errors[0]?.why).toBe(
      "Publishing the updated message to the room's members failed",
    );
    expect(errors[0]?.cause).toBeUndefined();
    expect(errors[0]?.event).toMatchObject({
      operation: "chat_signal_change_announce",
      messageId: MESSAGE.id,
      failure: { errorName: "Error" },
    });
    expect(errors[0]?.event.method).toBeUndefined();
    expect(JSON.stringify(errors[0]?.event)).not.toContain("pricing sheet");
  });
});
