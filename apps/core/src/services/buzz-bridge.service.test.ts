import { getPublicKey } from "nostr-tools/pure";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OPERATOR_KEY = "1".repeat(64);
const env = vi.hoisted(() => ({
  value: {} as Record<string, string | undefined>,
}));
vi.mock("@/config/env", () => ({ getEnv: () => env.value }));

const db = vi.hoisted(() => {
  const model = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  });
  return {
    chatRoom: model(),
    buzzCommunity: model(),
    buzzOutbox: model(),
    buzzMessageLink: model(),
    buzzReactionLink: model(),
    buzzIdentity: model(),
    buzzChannel: model(),
    chatRoomMessage: model(),
  };
});
vi.mock("@/lib/db/prisma", () => ({ default: db }));

import { sealSecret } from "@/lib/buzz/secret-box";
import {
  applyInboundEvent,
  type CoreRequest,
  drainBuzzOutbox,
  enqueueBuzzSync,
  OUTBOX_SETTLE_MS,
} from "./buzz-bridge.service";

const CHANNEL = "6f7c1b2e-0000-4000-8000-000000000001";
const BOB_PUBKEY = "b".repeat(64);
const BOT_PUBKEY = "c".repeat(64);
const SECRET = "s".repeat(32);

function nostrEvent(
  overrides: Partial<{
    id: string;
    pubkey: string;
    kind: number;
    tags: string[][];
    content: string;
  }>,
) {
  return {
    id: "e".repeat(64),
    pubkey: BOB_PUBKEY,
    created_at: 0,
    kind: 9,
    tags: [["h", CHANNEL]],
    content: "",
    sig: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  env.value = {
    BUZZ_COMMUNITY_URL_TEMPLATE: "ws://relay",
    BUZZ_OPERATOR_SECRET_KEY: OPERATOR_KEY,
    BUZZ_KEY_ENCRYPTION_SECRET: SECRET,
  };
});

describe("enqueueBuzzSync", () => {
  it("does nothing while Buzz is not configured", async () => {
    env.value = {};
    await enqueueBuzzSync({ roomId: "room", messageId: "m" });
    expect(db.chatRoom.findUnique).not.toHaveBeenCalled();
    expect(db.buzzOutbox.create).not.toHaveBeenCalled();
  });

  it("queues a change in a room of an organization on Buzz", async () => {
    db.chatRoom.findUnique.mockResolvedValue({
      kind: "channel",
      buzzChannel: null,
      organization: { buzzCommunity: { id: "community" } },
      userMembers: [],
    });
    await enqueueBuzzSync({ roomId: "room", messageId: "m" });
    expect(db.buzzOutbox.create).toHaveBeenCalledWith({
      data: { roomId: "room", messageId: "m" },
    });
  });

  it("never lets a Buzz failure fail the chat write", async () => {
    db.chatRoom.findUnique.mockRejectedValue(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      enqueueBuzzSync({ roomId: "room", messageId: "m" }),
    ).resolves.toBeUndefined();
    error.mockRestore();
  });
});

describe("applyInboundEvent", () => {
  const core = vi.fn<CoreRequest>(async () => ({ status: 201, body: {} }));
  const bob = {
    id: "identity-bob",
    pubkey: BOB_PUBKEY,
    userId: "user-bob",
    encryptedApiKey: sealSecret("bob-api-key", SECRET),
  };

  beforeEach(() => {
    db.buzzMessageLink.findUnique.mockResolvedValue(null);
    db.buzzReactionLink.findUnique.mockResolvedValue(null);
    db.buzzIdentity.findUnique.mockResolvedValue(bob);
  });

  it("treats events the bridge sent itself as echoes", async () => {
    db.buzzMessageLink.findUnique.mockResolvedValueOnce({ messageId: "m" });
    await expect(
      applyInboundEvent(nostrEvent({ content: "x" }), core),
    ).resolves.toBe("echo");
    await expect(
      applyInboundEvent(
        nostrEvent({ pubkey: getPublicKey(Buffer.from(OPERATOR_KEY, "hex")) }),
        core,
      ),
    ).resolves.toBe("echo");
    expect(core).not.toHaveBeenCalled();
  });

  it("ignores people Sokosumi does not know and bots, who speak only through Sokosumi", async () => {
    db.buzzIdentity.findUnique.mockResolvedValueOnce(null);
    await expect(
      applyInboundEvent(nostrEvent({ content: "x" }), core),
    ).resolves.toBe("ignored");
    db.buzzIdentity.findUnique.mockResolvedValueOnce({
      ...bob,
      userId: null,
      sokoBotId: "bot",
    });
    await expect(
      applyInboundEvent(nostrEvent({ content: "x" }), core),
    ).resolves.toBe("ignored");
    expect(core).not.toHaveBeenCalled();
  });

  it("posts a Buzz reply as its author into the thread's root, with mentions", async () => {
    db.buzzChannel.findUnique.mockResolvedValue({
      roomId: "room",
      channelId: CHANNEL,
    });
    db.buzzMessageLink.findUnique
      .mockResolvedValueOnce(null)
      // The parent is itself a reply: Sokosumi threads have one level.
      .mockResolvedValueOnce({
        message: { id: "reply-1", parentMessageId: "root-1" },
      });
    db.buzzIdentity.findMany.mockResolvedValue([
      {
        pubkey: BOT_PUBKEY,
        userId: null,
        sokoBotId: "bot-1",
        coworkerId: null,
        user: null,
        sokoBot: { name: "Joey" },
        coworker: null,
      },
    ]);
    const parentEventId = "f".repeat(64);
    await expect(
      applyInboundEvent(
        nostrEvent({
          tags: [
            ["h", CHANNEL],
            ["e", parentEventId, "", "reply"],
            ["p", BOT_PUBKEY],
          ],
          content: "what is 2 + 2?",
        }),
        core,
      ),
    ).resolves.toBe("posted");
    expect(core).toHaveBeenCalledWith({
      method: "POST",
      path: "/v1/chats/rooms/room/messages",
      apiKey: "bob-api-key",
      body: {
        content: "what is 2 + 2?",
        clientMessageId: `buzz:${"e".repeat(64)}`,
        parentMessageId: "root-1",
        mentionedUserIds: [],
        mentionedSokoBotIds: ["bot-1"],
        mentionedCoworkerIds: [],
      },
    });
  });

  it("marks an edit as known before replaying it, so its echo is not sent back", async () => {
    db.buzzMessageLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        messageId: "m1",
        contentHash: "old",
        message: { roomId: "room" },
      });
    await expect(
      applyInboundEvent(
        nostrEvent({
          kind: 40003,
          tags: [
            ["h", CHANNEL],
            ["e", "f".repeat(64)],
          ],
          content: "fixed",
        }),
        core,
      ),
    ).resolves.toBe("edited");
    const linkUpdate = db.buzzMessageLink.update.mock.invocationCallOrder[0];
    const patch = core.mock.invocationCallOrder[0];
    expect(linkUpdate).toBeLessThan(patch);
    expect(core).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        path: "/v1/chats/rooms/room/messages/m1",
        body: { content: "fixed" },
      }),
    );
  });
});

describe("drainBuzzOutbox", () => {
  it("waits until a message has been quiet, so a streaming reply goes out once", async () => {
    const now = new Date("2026-11-11T00:00:10Z");
    db.buzzOutbox.findMany.mockResolvedValue([
      {
        id: "1",
        roomId: "room",
        messageId: "streaming",
        attempts: 0,
        createdAt: new Date(now.getTime() - OUTBOX_SETTLE_MS - 5_000),
      },
      {
        id: "2",
        roomId: "room",
        messageId: "streaming",
        attempts: 0,
        createdAt: new Date(now.getTime() - 100),
      },
    ]);
    await expect(drainBuzzOutbox({ now })).resolves.toEqual([]);
    expect(db.chatRoomMessage.findUnique).not.toHaveBeenCalled();
    expect(db.buzzOutbox.deleteMany).not.toHaveBeenCalled();
  });
});
