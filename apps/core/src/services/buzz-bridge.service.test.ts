import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
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
    upsert: vi.fn(),
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

import { contentHash } from "@/lib/buzz/events";
import { sealSecret } from "@/lib/buzz/secret-box";
import {
  applyInboundEvent,
  BuzzTargetPendingError,
  type CoreRequest,
  drainBuzzOutbox,
  enqueueBuzzSync,
  OUTBOX_SETTLE_MS,
} from "./buzz-bridge.service";

const CHANNEL = "6f7c1b2e-0000-4000-8000-000000000001";
const BOB_KEY = generateSecretKey();
const BOB_PUBKEY = getPublicKey(BOB_KEY);
const BOT_PUBKEY = "c".repeat(64);
const SECRET = "s".repeat(32);

/** A signed event, as the relay delivers it. */
function nostrEvent(
  overrides: Partial<{ kind: number; tags: string[][]; content: string }>,
  secretKey: Uint8Array = BOB_KEY,
) {
  return finalizeEvent(
    {
      created_at: 0,
      kind: 9,
      tags: [["h", CHANNEL]],
      content: "",
      ...overrides,
    },
    secretKey,
  );
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

  it("ignores an event whose signature does not check out", async () => {
    const forged = { ...nostrEvent({ content: "x" }), content: "changed" };
    await expect(applyInboundEvent(forged, core)).resolves.toBe("ignored");
    expect(core).not.toHaveBeenCalled();
  });

  it("treats events the bridge sent itself as echoes", async () => {
    db.buzzMessageLink.findUnique.mockResolvedValueOnce({ messageId: "m" });
    await expect(
      applyInboundEvent(nostrEvent({ content: "x" }), core),
    ).resolves.toBe("echo");
    await expect(
      applyInboundEvent(
        nostrEvent({}, Uint8Array.from(Buffer.from(OPERATOR_KEY, "hex"))),
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
    const reply = nostrEvent({
      tags: [
        ["h", CHANNEL],
        ["e", parentEventId, "", "reply"],
        ["p", BOT_PUBKEY],
      ],
      content: "what is 2 + 2?",
    });
    core.mockResolvedValueOnce({
      status: 201,
      body: { data: { id: "new-message" } },
    });
    await expect(applyInboundEvent(reply, core)).resolves.toBe("posted");
    // Linked at once, so a reply or reaction to it right after finds it.
    expect(db.buzzMessageLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { messageId: "new-message" },
        create: expect.objectContaining({ eventId: reply.id }),
      }),
    );
    expect(core).toHaveBeenCalledWith({
      method: "POST",
      path: "/v1/chats/rooms/room/messages",
      apiKey: "bob-api-key",
      body: {
        content: "what is 2 + 2?",
        clientMessageId: `buzz:${reply.id}`,
        parentMessageId: "root-1",
        mentionedUserIds: [],
        mentionedSokoBotIds: ["bot-1"],
        mentionedCoworkerIds: [],
      },
    });
  });

  it("records an edit only after Core has it, so a crash in between replays it", async () => {
    db.buzzMessageLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        messageId: "m1",
        contentHash: "old",
        lastEditAt: 0,
        lastEditEventId: null,
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
    expect(patch).toBeLessThan(linkUpdate);
    expect(core).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        path: "/v1/chats/rooms/room/messages/m1",
        body: { content: "fixed" },
      }),
    );
  });
});

describe("applyInboundEvent edits", () => {
  const core = vi.fn<CoreRequest>(async () => ({ status: 200, body: {} }));
  const editOf = (createdAt: number, content: string) =>
    finalizeEvent(
      {
        created_at: createdAt,
        kind: 40003,
        tags: [
          ["h", CHANNEL],
          ["e", "f".repeat(64)],
        ],
        content,
      },
      BOB_KEY,
    );

  beforeEach(() => {
    db.buzzReactionLink.findUnique.mockResolvedValue(null);
    db.buzzIdentity.findUnique.mockResolvedValue({
      id: "identity-bob",
      pubkey: BOB_PUBKEY,
      userId: "user-bob",
      encryptedApiKey: sealSecret("bob-api-key", SECRET),
    });
  });

  it("ignores an edit older than the newest one applied, as on a replay", async () => {
    db.buzzMessageLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        messageId: "m1",
        contentHash: "newer",
        lastEditAt: 200,
        lastEditEventId: "f".repeat(64),
        message: { roomId: "room" },
      });
    await expect(applyInboundEvent(editOf(100, "older"), core)).resolves.toBe(
      "echo",
    );
    expect(core).not.toHaveBeenCalled();
  });

  it("records nothing when Core refuses the edit, so a retry applies it", async () => {
    db.buzzMessageLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        messageId: "m1",
        contentHash: "old",
        lastEditAt: 0,
        lastEditEventId: null,
        message: { roomId: "room" },
      });
    core.mockResolvedValueOnce({ status: 503, body: {} });
    await expect(
      applyInboundEvent(editOf(300, "fixed"), core),
    ).rejects.toThrow();
    expect(db.buzzMessageLink.update).not.toHaveBeenCalled();
  });

  it("settles two edits in the same second on the lower id, whichever arrives first", async () => {
    const a = editOf(300, "first");
    const b = editOf(300, "second");
    const [lower, higher] = a.id < b.id ? [a, b] : [b, a];
    db.buzzMessageLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        messageId: "m1",
        contentHash: contentHash(lower.content),
        lastEditAt: 300,
        lastEditEventId: lower.id,
        message: { roomId: "room" },
      });
    await expect(applyInboundEvent(higher, core)).resolves.toBe("echo");
    expect(core).not.toHaveBeenCalled();
  });
});

describe("applyInboundEvent ordering", () => {
  const core = vi.fn<CoreRequest>(async () => ({ status: 201, body: {} }));

  beforeEach(() => {
    db.buzzReactionLink.findUnique.mockResolvedValue(null);
    db.buzzMessageLink.findUnique.mockResolvedValue(null);
    db.buzzChannel.findUnique.mockResolvedValue({
      roomId: "room",
      channelId: CHANNEL,
    });
    db.buzzIdentity.findUnique.mockResolvedValue({
      id: "identity-bob",
      pubkey: BOB_PUBKEY,
      userId: "user-bob",
      encryptedApiKey: sealSecret("bob-api-key", SECRET),
    });
    db.buzzIdentity.findMany.mockResolvedValue([]);
  });

  it("waits for a reply's parent instead of starting a new thread", async () => {
    const reply = nostrEvent({
      tags: [
        ["h", CHANNEL],
        ["e", "f".repeat(64), "", "reply"],
      ],
      content: "too early",
    });
    await expect(applyInboundEvent(reply, core)).rejects.toBeInstanceOf(
      BuzzTargetPendingError,
    );
    expect(core).not.toHaveBeenCalled();
    // The last try posts it anyway, so nothing is lost.
    await expect(
      applyInboundEvent(reply, core, { finalAttempt: true }),
    ).resolves.toBe("posted");
  });

  it("remembers a newer edit that matches the text, so an older one cannot win later", async () => {
    db.buzzMessageLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        messageId: "m1",
        contentHash: contentHash("same"),
        lastEditAt: 100,
        lastEditEventId: null,
        message: { roomId: "room" },
      });
    const edit = finalizeEvent(
      {
        created_at: 200,
        kind: 40003,
        tags: [
          ["h", CHANNEL],
          ["e", "f".repeat(64)],
        ],
        content: "same",
      },
      BOB_KEY,
    );
    await expect(applyInboundEvent(edit, core)).resolves.toBe("echo");
    expect(core).not.toHaveBeenCalled();
    expect(db.buzzMessageLink.update).toHaveBeenCalledWith({
      where: { messageId: "m1" },
      data: {
        contentHash: contentHash("same"),
        lastEditAt: 200,
        lastEditEventId: edit.id,
      },
    });
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

  it("keeps a failed message for later instead of dropping it", async () => {
    const now = new Date("2026-11-11T00:00:10Z");
    db.buzzOutbox.findMany.mockResolvedValue([
      {
        id: "1",
        roomId: "room",
        messageId: "m1",
        attempts: 9,
        createdAt: new Date(now.getTime() - 60_000),
      },
    ]);
    db.chatRoomMessage.findUnique.mockRejectedValue(new Error("relay down"));
    const outcomes = await drainBuzzOutbox({ now });
    expect(outcomes).toEqual([{ key: "m1", result: "error: relay down" }]);
    expect(db.buzzOutbox.deleteMany).not.toHaveBeenCalled();
    expect(db.buzzOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["1"] } },
      data: expect.objectContaining({
        attempts: 10,
        nextAttemptAt: new Date(now.getTime() + 10 * 60_000),
      }),
    });
  });
});
