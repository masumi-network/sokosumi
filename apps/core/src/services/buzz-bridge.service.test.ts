import { npubEncode } from "nostr-tools/nip19";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    count: vi.fn(),
    createMany: vi.fn(),
    groupBy: vi.fn(async (): Promise<unknown[]> => []),
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
    buzzCommunityMember: model(),
    coworker: model(),
    vendor: model(),
    workspace: model(),
    coworkerWorkspaceAccess: model(),
    coworkerApiKey: model(),
    member: model(),
    user: model(),
    sokoBot: model(),
    $transaction: vi.fn(async (operations: unknown[]) =>
      Promise.all(operations),
    ),
  };
});
vi.mock("@/lib/db/prisma", () => ({ default: db }));
const approvers = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("@/helpers/coworker-workspace-access", () => ({
  notifyWorkspaceApproversOfPendingCoworkerAccess: approvers.notify,
}));
const relay = vi.hoisted(() => ({ queryEvents: vi.fn() }));
vi.mock("@/lib/buzz/relay-client", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/buzz/relay-client")>()),
  queryEvents: relay.queryEvents,
}));

import { contentHash } from "@/lib/buzz/events";
import { ownerAuthTag } from "@/lib/buzz/owner-attestation";
import { sealSecret } from "@/lib/buzz/secret-box";
import {
  applyInboundEvent,
  BuzzTargetPendingError,
  buzzContentOf,
  CoreRejectedError,
  type CoreRequest,
  drainBuzzOutbox,
  enqueueBuzzSync,
  linkBuzzApp,
  OUTBOX_SETTLE_MS,
  syncBuzzAgents,
  vouched,
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
  // Each test sets the room it needs; none inherits another's.
  db.chatRoom.findUnique.mockReset();
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
    db.buzzIdentity.findFirst.mockResolvedValue(bob);
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
    db.buzzIdentity.findFirst.mockResolvedValueOnce(null);
    await expect(
      applyInboundEvent(nostrEvent({ content: "x" }), core),
    ).resolves.toBe("ignored");
    db.buzzIdentity.findFirst.mockResolvedValueOnce({
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
    db.buzzIdentity.findFirst.mockResolvedValue({
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

  it("names the people an edit mentions, as a new message does", async () => {
    db.buzzMessageLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        messageId: "m1",
        contentHash: "before",
        lastEditAt: 0,
        lastEditEventId: null,
        message: { roomId: "room" },
      });
    db.buzzIdentity.findMany.mockResolvedValue([
      {
        pubkey: BOT_PUBKEY,
        appPubkey: null,
        user: { name: "Alice" },
        sokoBot: null,
        coworker: null,
      },
    ]);
    await expect(
      applyInboundEvent(
        editOf(100, `ask nostr:${npubEncode(BOT_PUBKEY)} please`),
        core,
      ),
    ).resolves.toBe("edited");
    expect(core).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        body: { content: "ask @Alice please" },
      }),
    );
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
    db.buzzIdentity.findFirst.mockResolvedValue({
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

  it("waits on a message's newest change even when it lies beyond the page read", async () => {
    const now = new Date("2026-11-11T00:00:10Z");
    db.buzzOutbox.findMany.mockResolvedValue([
      {
        id: "1",
        roomId: "room",
        messageId: "streaming",
        attempts: 0,
        createdAt: new Date(now.getTime() - 60_000),
      },
    ]);
    db.buzzOutbox.groupBy.mockResolvedValueOnce([
      {
        messageId: "streaming",
        _max: { createdAt: new Date(now.getTime() - 100) },
      },
    ]);
    await expect(drainBuzzOutbox({ now })).resolves.toEqual([]);
    expect(db.chatRoomMessage.findUnique).not.toHaveBeenCalled();
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

describe("own Buzz app key", () => {
  const core = vi.fn<CoreRequest>(async () => ({ status: 201, body: {} }));
  const APP_KEY = generateSecretKey();
  const APP_PUBKEY = getPublicKey(APP_KEY);
  const bob = {
    id: "identity-bob",
    pubkey: BOB_PUBKEY,
    appPubkey: APP_PUBKEY,
    userId: "user-bob",
    encryptedApiKey: sealSecret("bob-api-key", SECRET),
  };

  beforeEach(() => {
    db.member.findMany.mockResolvedValue([
      {
        role: "member",
        organization: {
          id: "org",
          name: "Acme",
          buzzCommunity: { relayUrl: "ws://relay" },
        },
      },
    ]);
    db.buzzCommunity.findMany.mockResolvedValue([]);
  });

  it("posts what the app key writes as its person, and remembers Sokosumi cannot change it", async () => {
    db.buzzMessageLink.findUnique.mockResolvedValue(null);
    db.buzzReactionLink.findUnique.mockResolvedValue(null);
    db.buzzIdentity.findFirst.mockResolvedValue(bob);
    db.buzzIdentity.findMany.mockResolvedValue([]);
    db.buzzChannel.findUnique.mockResolvedValue({
      roomId: "room",
      channelId: CHANNEL,
    });
    core.mockResolvedValueOnce({
      status: 201,
      body: { data: { id: "new-message" } },
    });
    const event = nostrEvent({ content: "from my own key" }, APP_KEY);
    await expect(applyInboundEvent(event, core)).resolves.toBe("posted");
    expect(db.buzzIdentity.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ pubkey: APP_PUBKEY }, { appPubkey: APP_PUBKEY }] },
    });
    expect(core).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "bob-api-key" }),
    );
    expect(db.buzzMessageLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          eventId: event.id,
          signerPubkey: APP_PUBKEY,
        }),
      }),
    );
  });

  it("drops a Buzz post whose client id Core says belongs to someone else", async () => {
    db.buzzMessageLink.findUnique.mockResolvedValue(null);
    db.buzzReactionLink.findUnique.mockResolvedValue(null);
    db.buzzIdentity.findFirst.mockResolvedValue(bob);
    db.buzzIdentity.findMany.mockResolvedValue([]);
    db.buzzChannel.findUnique.mockResolvedValue({
      roomId: "room",
      channelId: CHANNEL,
    });
    core.mockResolvedValueOnce({ status: 409, body: { error: "Conflict" } });
    const rejected = applyInboundEvent(
      nostrEvent({ content: "x" }, APP_KEY),
      core,
    );
    await expect(rejected).rejects.toBeInstanceOf(CoreRejectedError);
    await expect(rejected).rejects.toMatchObject({ terminal: true });
    expect(db.buzzMessageLink.upsert).not.toHaveBeenCalled();
  });
});

describe("a person's own Buzz agents", () => {
  const core = vi.fn<CoreRequest>(async () => ({ status: 201, body: {} }));
  const OWNER_KEY = generateSecretKey();
  const OWNER_PUBKEY = getPublicKey(OWNER_KEY);
  const AGENT_KEY = generateSecretKey();
  const AGENT_PUBKEY = getPublicKey(AGENT_KEY);
  const agentIdentity = {
    id: "identity-agent",
    pubkey: AGENT_PUBKEY,
    appPubkey: null,
    userId: null,
    sokoBotId: null,
    coworkerId: "coworker-agent",
    encryptedSecretKey: null,
    encryptedApiKey: sealSecret("coworker_agent-key", SECRET),
    ownerIdentityId: "identity-bob",
  };

  beforeEach(() => {
    db.buzzMessageLink.findUnique.mockResolvedValue(null);
    db.buzzReactionLink.findUnique.mockResolvedValue(null);
    db.buzzIdentity.findMany.mockResolvedValue([]);
    db.buzzChannel.findUnique.mockResolvedValue({
      roomId: "room",
      channelId: CHANNEL,
    });
  });

  it("posts what an agent writes as its Coworker, and never edits it from Sokosumi", async () => {
    db.buzzIdentity.findFirst.mockResolvedValue(agentIdentity);
    core.mockResolvedValueOnce({
      status: 201,
      body: { data: { id: "agent-message" } },
    });
    const event = nostrEvent({ content: "done: tests pass" }, AGENT_KEY);
    await expect(applyInboundEvent(event, core)).resolves.toBe("posted");
    expect(core).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "coworker_agent-key" }),
    );
    expect(db.buzzMessageLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ signerPubkey: AGENT_PUBKEY }),
      }),
    );
  });

  it("ignores an agent's reactions, which Core does not take from a Coworker", async () => {
    db.buzzIdentity.findFirst.mockResolvedValue(agentIdentity);
    const reaction = nostrEvent(
      {
        kind: 7,
        tags: [
          ["h", CHANNEL],
          ["e", "f".repeat(64)],
        ],
        content: "👍",
      },
      AGENT_KEY,
    );
    await expect(applyInboundEvent(reaction, core)).resolves.toBe("ignored");
    expect(core).not.toHaveBeenCalled();
  });

  it("makes a Coworker only of an agent whose profile its owner signed", async () => {
    const STRANGER_KEY = generateSecretKey();
    const STRANGER = getPublicKey(STRANGER_KEY);
    db.buzzIdentity.findMany.mockResolvedValueOnce([
      {
        id: "identity-bob",
        userId: "user-bob",
        appPubkey: OWNER_PUBKEY,
        user: { name: "Bob" },
      },
    ]);
    db.member.findMany.mockResolvedValue([
      {
        role: "member",
        organization: {
          id: "org",
          name: "Acme",
          // An organization that asks for approval of personal agents.
          buzzCommunity: {
            relayUrl: "wss://acme.example",
            allowPersonalAgents: false,
          },
        },
      },
    ]);
    db.buzzCommunity.findMany.mockResolvedValue([]);
    db.workspace.findMany.mockResolvedValue([
      { id: "workspace", userId: "user-bob", organizationId: null },
      { id: "org-workspace", userId: null, organizationId: "org" },
    ]);
    db.vendor.upsert.mockResolvedValue({ id: "vendor" });
    db.buzzIdentity.findUnique.mockResolvedValue(null);
    db.coworker.create.mockResolvedValue({ id: "coworker-new" });
    db.coworkerWorkspaceAccess.findUnique.mockResolvedValue(null);
    db.coworkerWorkspaceAccess.create.mockImplementation(
      async ({
        data,
      }: {
        data: { coworkerId: string; workspaceId: string };
      }) => ({
        id: `access-${data.workspaceId}`,
        coworkerId: data.coworkerId,
      }),
    );
    db.coworker.findMany.mockResolvedValue([]);
    const record = (pubkey: string) =>
      finalizeEvent(
        {
          kind: 30177,
          created_at: 1,
          tags: [["d", pubkey]],
          content: JSON.stringify({ name: "Claude Code" }),
        },
        OWNER_KEY,
      );
    const profile = (key: Uint8Array, tags: string[][]) =>
      finalizeEvent(
        { kind: 0, created_at: 2, tags, content: '{"name":"Claude Code"}' },
        key,
      );
    relay.queryEvents
      .mockResolvedValueOnce([record(AGENT_PUBKEY), record(STRANGER)])
      .mockResolvedValueOnce([
        profile(AGENT_KEY, [ownerAuthTag(OWNER_KEY, AGENT_PUBKEY)]),
        // Claims Bob as owner with a signature for another key.
        profile(STRANGER_KEY, [ownerAuthTag(OWNER_KEY, AGENT_PUBKEY)]),
      ]);
    await expect(syncBuzzAgents()).resolves.toEqual(["coworker-new"]);
    // Bob's agents have a vendor of their own: Core lets a vendor's Coworkers
    // see each other's work.
    expect(db.vendor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: "buzz-agents-identity-bob" } }),
    );
    expect(db.coworker.create).toHaveBeenCalledTimes(1);
    expect(db.coworker.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Claude Code (personal agent)",
        caption: "Personal agent via Buzz · Bob",
        baseURL: "buzz://acme.example",
        capabilities: ["chat"],
        assignments: { create: { userId: "user-bob" } },
      }),
    });
    expect(db.coworker.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        buzzIdentity: {
          create: { pubkey: AGENT_PUBKEY, ownerIdentityId: "identity-bob" },
        },
      }),
    });
    // Bob's own workspace: his to grant.
    expect(db.coworkerWorkspaceAccess.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace",
        status: "GRANTED",
      }),
    });
    // An organization he is only a member of: requested, and its admins told.
    expect(db.coworkerWorkspaceAccess.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "org-workspace",
        status: "PENDING",
      }),
    });
    expect(approvers.notify).toHaveBeenCalledTimes(1);
    expect(approvers.notify).toHaveBeenCalledWith({
      coworkerId: "coworker-new",
      workspaceId: "org-workspace",
      accessId: "access-org-workspace",
    });
  });
});

describe("agents of a person signed in to Buzz with Sokosumi's key", () => {
  it("finds an agent the Sokosumi key owns, with no app key linked", async () => {
    const SOKOSUMI_KEY = generateSecretKey();
    const SOKOSUMI_PUBKEY = getPublicKey(SOKOSUMI_KEY);
    const AGENT_KEY = generateSecretKey();
    const AGENT_PUBKEY = getPublicKey(AGENT_KEY);
    db.buzzIdentity.findMany.mockResolvedValueOnce([
      {
        id: "identity-bob",
        userId: "user-bob",
        pubkey: SOKOSUMI_PUBKEY,
        appPubkey: null,
        user: { name: "Bob" },
      },
    ]);
    db.member.findMany.mockResolvedValue([
      {
        role: "owner",
        organization: {
          id: "org",
          name: "Acme",
          buzzCommunity: { relayUrl: "wss://acme.example" },
        },
      },
    ]);
    db.buzzCommunity.findMany.mockResolvedValue([]);
    db.workspace.findMany.mockResolvedValue([]);
    db.vendor.upsert.mockResolvedValue({ id: "vendor" });
    db.buzzIdentity.findUnique.mockResolvedValue(null);
    db.coworker.create.mockResolvedValue({ id: "coworker-sokosumi-owned" });
    db.coworker.findMany.mockResolvedValue([]);
    relay.queryEvents
      .mockResolvedValueOnce([
        finalizeEvent(
          {
            kind: 30177,
            created_at: 1,
            tags: [["d", AGENT_PUBKEY]],
            content: '{"name":"Claude Code"}',
          },
          SOKOSUMI_KEY,
        ),
      ])
      .mockResolvedValueOnce([
        finalizeEvent(
          {
            kind: 0,
            created_at: 2,
            tags: [ownerAuthTag(SOKOSUMI_KEY, AGENT_PUBKEY)],
            content: '{"name":"Claude Code"}',
          },
          AGENT_KEY,
        ),
      ]);
    await expect(syncBuzzAgents()).resolves.toEqual([
      "coworker-sokosumi-owned",
    ]);
    expect(relay.queryEvents).toHaveBeenNthCalledWith(1, {
      relayUrl: "wss://acme.example",
      secretKey: expect.any(Uint8Array),
      filters: [{ kinds: [30177], authors: [SOKOSUMI_PUBKEY] }],
    });
  });
});

describe("personal agents", () => {
  const core = vi.fn<CoreRequest>(async () => ({ status: 200, body: {} }));
  const AGENT = getPublicKey(generateSecretKey());
  const bob = {
    id: "identity-bob",
    pubkey: BOB_PUBKEY,
    appPubkey: null,
    userId: "user-bob",
    coworkerId: null,
    encryptedSecretKey: "x",
    encryptedApiKey: sealSecret("bob-api-key", SECRET),
  };

  it("adds to the Sokosumi room the agent its owner invited on Buzz", async () => {
    db.buzzMessageLink.findUnique.mockResolvedValue(null);
    db.buzzReactionLink.findUnique.mockResolvedValue(null);
    db.buzzIdentity.findFirst.mockResolvedValue(bob);
    db.buzzChannel.findUnique.mockResolvedValue({
      roomId: "room",
      channelId: CHANNEL,
      membersHash: "abc",
      community: { relayUrl: "ws://relay" },
    });
    db.buzzIdentity.findMany.mockResolvedValue([
      { pubkey: AGENT, coworkerId: "cw-agent" },
    ]);
    // The channel shows the agent as a member now.
    relay.queryEvents.mockResolvedValue([
      { kind: 39002, created_at: 1, tags: [["p", AGENT]] },
    ]);
    const invite = nostrEvent({
      kind: 9000,
      tags: [
        ["h", CHANNEL],
        ["p", AGENT],
      ],
    });
    await expect(applyInboundEvent(invite, core)).resolves.toBe("members");
    expect(db.buzzIdentity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerIdentityId: "identity-bob" }),
      }),
    );
    expect(core).toHaveBeenCalledWith({
      method: "POST",
      path: "/v1/chats/rooms/room/members",
      apiKey: "bob-api-key",
      body: { coworkerIds: ["cw-agent"] },
    });
  });

  it("looks for the owner's agents first when an invite names a key it does not know yet", async () => {
    db.buzzMessageLink.findUnique.mockResolvedValue(null);
    db.buzzReactionLink.findUnique.mockResolvedValue(null);
    db.buzzIdentity.findFirst.mockResolvedValue(bob);
    db.buzzChannel.findUnique.mockResolvedValue({
      roomId: "room",
      channelId: CHANNEL,
      membersHash: "abc",
      community: { relayUrl: "ws://relay" },
    });
    // Made in Buzz a moment ago: no identity for it yet.
    db.buzzIdentity.count.mockResolvedValueOnce(0);
    db.buzzIdentity.findMany
      // The agent sweep, for Bob only (finding nothing new to make here).
      .mockResolvedValueOnce([])
      // Then the invite's lookup finds the agent the sweep made.
      .mockResolvedValueOnce([{ pubkey: AGENT, coworkerId: "cw-agent" }]);
    relay.queryEvents.mockResolvedValue([
      { kind: 39002, created_at: 1, tags: [["p", AGENT]] },
    ]);
    const invite = nostrEvent({
      kind: 9000,
      tags: [
        ["h", CHANNEL],
        ["p", AGENT],
      ],
    });
    await expect(applyInboundEvent(invite, core)).resolves.toBe("members");
    expect(db.buzzIdentity.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { userId: { not: null }, id: "identity-bob" },
      }),
    );
    expect(core).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/v1/chats/rooms/room/members",
        body: { coworkerIds: ["cw-agent"] },
      }),
    );
  });

  it("does not let a replayed invite undo a later removal", async () => {
    db.buzzMessageLink.findUnique.mockResolvedValue(null);
    db.buzzReactionLink.findUnique.mockResolvedValue(null);
    db.buzzIdentity.findFirst.mockResolvedValue(bob);
    db.buzzChannel.findUnique.mockResolvedValue({
      roomId: "room",
      channelId: CHANNEL,
      membersHash: "abc",
      community: { relayUrl: "ws://relay" },
    });
    db.buzzIdentity.findMany.mockResolvedValue([
      { pubkey: AGENT, coworkerId: "cw-agent" },
    ]);
    // Removed since: the channel no longer has the agent.
    relay.queryEvents.mockResolvedValue([
      { kind: 39002, created_at: 1, tags: [] },
    ]);
    const invite = nostrEvent({
      kind: 9000,
      tags: [
        ["h", CHANNEL],
        ["p", AGENT],
      ],
    });
    await expect(applyInboundEvent(invite, core)).resolves.toBe("ignored");
    expect(core).not.toHaveBeenCalled();
  });

  it("leaves Buzz invites of anything but one's own agent to the member sync", async () => {
    db.buzzMessageLink.findUnique.mockResolvedValue(null);
    db.buzzReactionLink.findUnique.mockResolvedValue(null);
    db.buzzIdentity.findFirst.mockResolvedValue(bob);
    db.buzzChannel.findUnique.mockResolvedValue({
      roomId: "room",
      channelId: CHANNEL,
      membersHash: "abc",
      community: { relayUrl: "ws://relay" },
    });
    db.buzzIdentity.findMany.mockResolvedValue([]);
    const invite = nostrEvent({
      kind: 9000,
      tags: [
        ["h", CHANNEL],
        ["p", AGENT],
      ],
    });
    await expect(applyInboundEvent(invite, core)).resolves.toBe("ignored");
    expect(core).not.toHaveBeenCalled();
  });
});

describe("one-on-one Direct with a Coworker", () => {
  it("asks the Coworker through the room's stream, as the person", async () => {
    const core = vi.fn<CoreRequest>(async () => ({ status: 200, body: "" }));
    db.buzzMessageLink.findUnique.mockResolvedValue(null);
    db.buzzReactionLink.findUnique.mockResolvedValue(null);
    db.buzzIdentity.findFirst.mockResolvedValue({
      id: "identity-bob",
      pubkey: BOB_PUBKEY,
      userId: "user-bob",
      coworkerId: null,
      encryptedSecretKey: "x",
      encryptedApiKey: sealSecret("bob-api-key", SECRET),
    });
    db.buzzIdentity.findMany.mockResolvedValue([]);
    db.buzzChannel.findUnique.mockResolvedValue({
      roomId: "direct",
      channelId: CHANNEL,
    });
    db.chatRoom.findUnique.mockResolvedValue({
      kind: "direct",
      userMembers: [{ userId: "user-bob" }],
      coworkerMembers: [{ coworker: { baseURL: "https://agent.example" } }],
      sokoBotMembers: [],
    });
    db.chatRoomMessage.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: "stored" });
    const event = nostrEvent({ content: "summarize this" });
    await expect(applyInboundEvent(event, core)).resolves.toBe("posted");
    expect(core).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/v1/chats/rooms/direct/stream",
        apiKey: "bob-api-key",
        body: {
          messages: [
            {
              id: `buzz:${event.id}`,
              role: "user",
              parts: [{ type: "text", text: "summarize this" }],
            },
          ],
        },
      }),
    );
    expect(db.buzzMessageLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          messageId: "stored",
          eventId: event.id,
        }),
      }),
    );
  });
});

describe("a Direct question whose answer failed", () => {
  const setUpDirect = () => {
    db.buzzReactionLink.findUnique.mockResolvedValue(null);
    db.buzzIdentity.findFirst.mockResolvedValue({
      id: "identity-bob",
      pubkey: BOB_PUBKEY,
      userId: "user-bob",
      coworkerId: null,
      encryptedSecretKey: "x",
      encryptedApiKey: sealSecret("bob-api-key", SECRET),
    });
    db.buzzIdentity.findMany.mockResolvedValue([]);
    db.buzzChannel.findUnique.mockResolvedValue({
      roomId: "direct",
      channelId: CHANNEL,
    });
    db.chatRoom.findUnique.mockResolvedValue({
      kind: "direct",
      userMembers: [{ userId: "user-bob" }],
      coworkerMembers: [{ coworker: { baseURL: "https://agent.example" } }],
      sokoBotMembers: [],
    });
  };
  const storedQuestion = (eventId: string) => ({
    roomId: "direct",
    createdAt: new Date(),
    clientMessageId: `buzz:${eventId}`,
    room: { kind: "direct", coworkerMembers: [{ coworkerId: "coworker" }] },
  });

  it("hands the worker the answer that is still streaming", async () => {
    setUpDirect();
    db.buzzMessageLink.findUnique.mockResolvedValue(null);
    db.chatRoomMessage.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: "stored" });
    const core = vi.fn<CoreRequest>(async () => ({
      status: 200,
      body: null,
      finished: Promise.resolve(false),
    }));
    const onTurnStarted = vi.fn<(finished: Promise<boolean>) => void>();
    await expect(
      applyInboundEvent(nostrEvent({ content: "hi" }), core, { onTurnStarted }),
    ).resolves.toBe("posted");
    expect(onTurnStarted).toHaveBeenCalledOnce();
    await expect(onTurnStarted.mock.calls[0]?.[0]).resolves.toBe(false);
  });

  it("asks again for a linked question whose next message is not its answer", async () => {
    setUpDirect();
    const event = nostrEvent({ content: "hi" });
    const question = {
      id: "stored",
      ...storedQuestion(event.id),
      parentMessageId: null,
    };
    db.buzzMessageLink.findUnique.mockResolvedValue({ messageId: "stored" });
    db.chatRoomMessage.findUnique.mockResolvedValue(question);
    // Next after it: the person's next question (a later answer is that
    // one's); then the stored question itself, still with no answer.
    db.chatRoomMessage.findFirst
      .mockResolvedValueOnce({ senderCoworkerId: null })
      .mockResolvedValueOnce(question)
      .mockResolvedValueOnce({ senderCoworkerId: null })
      .mockResolvedValue(question);
    const core = vi.fn<CoreRequest>(async () => ({ status: 200, body: null }));
    await expect(applyInboundEvent(event, core)).resolves.toBe("posted");
    expect(core).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/v1/chats/rooms/direct/stream" }),
    );
    expect(db.chatRoomMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          parentMessageId: null,
          id: { not: "stored" },
        }),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );

    core.mockClear();
    db.chatRoomMessage.findFirst.mockReset();
    db.chatRoomMessage.findFirst.mockResolvedValue({
      senderCoworkerId: "coworker",
    });
    await expect(applyInboundEvent(event, core)).resolves.toBe("echo");
    expect(core).not.toHaveBeenCalled();
  });

  it("does not ask again for a question answered after a retry", async () => {
    setUpDirect();
    const event = nostrEvent({ content: "hi" });
    db.buzzMessageLink.findUnique.mockResolvedValue({
      messageId: "stored",
      answeredAt: new Date(),
    });
    // The next message is another question: its answer came later.
    db.chatRoomMessage.findFirst.mockResolvedValue({ senderCoworkerId: null });
    const core = vi.fn<CoreRequest>(async () => ({ status: 200, body: null }));
    await expect(applyInboundEvent(event, core)).resolves.toBe("echo");
    expect(core).not.toHaveBeenCalled();
  });
});

describe("buzzContentOf", () => {
  it("turns Sokosumi mention tokens into Buzz mentions, and names whoever has no key", async () => {
    const agent = "01a1cbc4-a52c-70e5-a792-d2b71db65927";
    const alice = "01a1cbc4-0000-70e5-a792-d2b71db65927";
    db.buzzIdentity.findMany.mockResolvedValue([
      {
        pubkey: BOT_PUBKEY,
        appPubkey: null,
        userId: null,
        coworkerId: agent,
        sokoBotId: null,
      },
    ]);
    db.user.findMany.mockResolvedValue([{ id: alice, name: "Alice" }]);
    db.coworker.findMany.mockResolvedValue([]);
    db.sokoBot.findMany.mockResolvedValue([]);
    const text = await buzzContentOf(
      `@${agent}:buzz-d64f20d52d985e4c hi, ask @${alice} too`,
    );
    expect(text).toBe(`nostr:${npubEncode(BOT_PUBKEY)} hi, ask @Alice too`);
  });

  it("leaves a message without mentions alone", async () => {
    await expect(buzzContentOf("plain")).resolves.toBe("plain");
    expect(db.buzzIdentity.findMany).not.toHaveBeenCalled();
  });
});

describe("linkBuzzApp", () => {
  const APP_KEY = generateSecretKey();
  const APP_PUBKEY = getPublicKey(APP_KEY);
  const SOKOSUMI_PUBKEY = BOB_PUBKEY;
  const identity = {
    id: "identity-bob",
    pubkey: SOKOSUMI_PUBKEY,
    appPubkey: APP_PUBKEY,
    userId: "user-bob",
  };

  beforeEach(() => {
    db.member.findMany.mockResolvedValue([
      {
        role: "member",
        organization: {
          id: "org",
          name: "Acme",
          buzzCommunity: { id: "community", relayUrl: "ws://relay" },
        },
      },
    ]);
    db.buzzChannel.findMany.mockResolvedValue([]);
    db.buzzIdentity.findFirst.mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: "invite-code" })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("links a new Buzz identity from its proof and invites its app", async () => {
    db.buzzIdentity.findUnique.mockResolvedValue({
      ...identity,
      appPubkey: null,
    });
    db.buzzIdentity.updateMany.mockResolvedValue({ count: 1 });
    const tag = ownerAuthTag(APP_KEY, SOKOSUMI_PUBKEY);
    const invites = await linkBuzzApp("user-bob", JSON.stringify(tag));
    expect(invites).toEqual([
      expect.objectContaining({
        organizationName: "Acme",
        joinUrl: expect.stringContaining("code=invite-code"),
      }),
    ]);
    expect(db.buzzIdentity.updateMany).toHaveBeenCalledWith({
      where: { id: "identity-bob", appPubkey: null },
      data: { appPubkey: APP_PUBKEY, appAuthTag: tag, profileHash: null },
    });
    expect(db.buzzCommunityMember.deleteMany).toHaveBeenCalledWith({
      where: { identityId: "identity-bob" },
    });
  });

  it("refuses when another link landed first, or the identity is someone else's", async () => {
    db.buzzIdentity.findUnique.mockResolvedValue({
      ...identity,
      appPubkey: null,
    });
    const tag = JSON.stringify(ownerAuthTag(APP_KEY, SOKOSUMI_PUBKEY));
    db.buzzIdentity.updateMany.mockResolvedValue({ count: 0 });
    await expect(linkBuzzApp("user-bob", tag)).rejects.toThrow(
      "another Buzz identity",
    );
    db.buzzIdentity.findFirst.mockResolvedValue({ id: "identity-alice" });
    db.buzzIdentity.updateMany.mockClear();
    await expect(linkBuzzApp("user-bob", tag)).rejects.toThrow(
      "belongs to another account",
    );
    expect(db.buzzIdentity.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the linked Buzz identity's proof, with new invites to resume joining", async () => {
    db.buzzIdentity.findUnique.mockResolvedValue(identity);
    const tag = ownerAuthTag(APP_KEY, SOKOSUMI_PUBKEY);
    await expect(linkBuzzApp("user-bob", JSON.stringify(tag))).resolves.toEqual(
      [expect.objectContaining({ organizationName: "Acme" })],
    );
    expect(db.buzzIdentity.update).toHaveBeenCalledWith({
      where: { id: "identity-bob" },
      data: { appAuthTag: tag },
    });
  });

  it("refuses a proof for another key, with conditions, or that is not one", async () => {
    db.buzzIdentity.findUnique.mockResolvedValue(identity);
    const stranger = generateSecretKey();
    for (const tag of [
      ownerAuthTag(APP_KEY, getPublicKey(stranger)),
      ownerAuthTag(APP_KEY, SOKOSUMI_PUBKEY, "kind=9"),
    ]) {
      await expect(
        linkBuzzApp("user-bob", JSON.stringify(tag)),
      ).rejects.toThrow("not for your Sokosumi key");
    }
    await expect(linkBuzzApp("user-bob", "nope")).rejects.toThrow(
      "Paste the whole proof",
    );
    expect(db.buzzIdentity.update).not.toHaveBeenCalled();
  });

  it("refuses another Buzz identity's proof while one is linked", async () => {
    db.buzzIdentity.findUnique.mockResolvedValue(identity);
    const other = ownerAuthTag(generateSecretKey(), SOKOSUMI_PUBKEY);
    await expect(
      linkBuzzApp("user-bob", JSON.stringify(other)),
    ).rejects.toThrow("another Buzz identity");
    expect(db.buzzIdentity.update).not.toHaveBeenCalled();
  });
});

describe("vouched", () => {
  const draft = { kind: 9, content: "hi", tags: [["h", CHANNEL]] };
  const identity = {
    id: "identity-bob",
    pubkey: BOB_PUBKEY,
    appPubkey: "a".repeat(64),
    appAuthTag: ["auth", "a".repeat(64), "", "b".repeat(128)],
  } as unknown as Parameters<typeof vouched>[0];

  it("carries the person's Buzz authorization on what Sokosumi signs for them", () => {
    expect(vouched(identity, draft).tags).toEqual([
      ["h", CHANNEL],
      ["auth", "a".repeat(64), "", "b".repeat(128)],
    ]);
  });

  it("sends nothing extra without an authorization from the linked key", () => {
    expect(vouched({ ...identity, appAuthTag: null }, draft)).toBe(draft);
    expect(vouched({ ...identity, appPubkey: null }, draft)).toBe(draft);
    expect(vouched({ ...identity, appPubkey: "c".repeat(64) }, draft)).toBe(
      draft,
    );
  });
});
