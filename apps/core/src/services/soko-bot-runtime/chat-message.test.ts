import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, watches, taint, deliver } = vi.hoisted(() => ({
  db: {
    workspace: { findUnique: vi.fn() },
    sokoBot: { findMany: vi.fn() },
    chatRoom: { findMany: vi.fn(), findFirst: vi.fn() },
    sokoBotTurn: { findMany: vi.fn() },
    sokoBotToolCall: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    sokoBotEffectOutbox: { findFirst: vi.fn() },
  },
  watches: {
    watchOriginTurnId: vi.fn(),
    chatReplyOutcome: vi.fn(),
    registerWatch: vi.fn(),
  },
  taint: { isTaintBlocked: vi.fn() },
  deliver: { deliverSokoBotEffect: vi.fn() },
}));

vi.mock("@/lib/db/prisma", () => ({ default: db }));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: async (run: (tx: unknown) => unknown) => run(db),
}));
vi.mock("@/services/soko-bot-watches.service", () => watches);
vi.mock("@/lib/soko-bot/turn-loop", () => taint);
vi.mock("@/services/soko-bot-effect-outbox.service", () => deliver);
vi.mock("@/routes/v1/chats/rooms/helpers", () => ({
  resolveMentionedSokoBotIds: ({ content }: { content: string }) =>
    content.includes("@Juno") ? ["juno"] : [],
}));
vi.mock("@/lib/soko-bot/coworker-question-room", () => ({
  createOrGetCoworkerQuestionRoom: vi.fn(async () => ({
    id: "ask-juno",
    name: "Ask Juno",
    created: true,
  })),
}));
vi.mock("../soko-bot-runtime.service", () => ({
  SokoBotRuntimeAuthorizationError: class extends Error {},
  SokoBotRuntimeValidationError: class extends Error {},
}));

import { resolveRecipient, sendMessage } from "./chat-message";

const runtime = {
  findCoworkers: vi.fn(),
  findTeammates: vi.fn(),
  postChat: vi.fn(),
  openDirectChat: vi.fn(),
  askCoworker: vi.fn(),
};

const authorized = (turn: Record<string, unknown> = {}, extra = {}) =>
  ({
    turn: {
      id: "turn-1",
      sokoBotId: "bot-1",
      workspaceId: "ws-1",
      actingUserId: "robin",
      chainDepth: 0,
      source: "CHAT",
      ...turn,
    },
    askedByKind: "OWNER",
    reader: { sharedScope: null },
    ...extra,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  db.workspace.findUnique.mockResolvedValue({ organizationId: "org-1" });
  runtime.findCoworkers.mockResolvedValue([
    { id: "mira", name: "Mira", slug: "mira-research", capabilities: ["chat"] },
    { id: "rex", name: "Rex", slug: "rex", capabilities: ["tasks"] },
  ]);
  runtime.findTeammates.mockResolvedValue([
    { userId: "robin", name: "Robin Keller", email: "robin@x.test" },
    { userId: "hannah", name: "Hannah Weber", email: "hannah@x.test" },
  ]);
  db.sokoBot.findMany.mockResolvedValue([
    {
      id: "juno",
      name: "Juno",
      userId: "hannah",
      user: { name: "Hannah Weber" },
    },
  ]);
  db.chatRoom.findMany.mockResolvedValue([
    { id: "launch", name: "Launch team", groupName: null },
  ]);
  db.chatRoom.findFirst.mockResolvedValue(null);
  db.sokoBotTurn.findMany.mockResolvedValue([]);
  db.sokoBotToolCall.findMany.mockResolvedValue([]);
  db.sokoBotEffectOutbox.findFirst.mockResolvedValue({ id: "effect-1" });
  watches.watchOriginTurnId.mockResolvedValue("turn-1");
  watches.chatReplyOutcome.mockResolvedValue(null);
  watches.registerWatch.mockResolvedValue({ waiting: true, watchId: "w-1" });
  taint.isTaintBlocked.mockResolvedValue(false);
  runtime.askCoworker.mockResolvedValue({
    roomId: "ask-mira",
    messageId: "m-1",
  });
  runtime.postChat.mockResolvedValue({ roomId: "launch", messageId: "m-2" });
  runtime.openDirectChat.mockResolvedValue({ roomId: "dm", messageId: "m-3" });
});

describe("resolveRecipient", () => {
  it("finds a Coworker, a person, another person's assistant and a room by name", async () => {
    const resolve = (to: string) =>
      resolveRecipient(runtime as never, authorized(), to);
    expect(await resolve("Mira")).toMatchObject({
      kind: "coworker",
      id: "mira",
    });
    expect(await resolve("@mira-research")).toMatchObject({ kind: "coworker" });
    expect(await resolve("Hannah")).toMatchObject({
      kind: "person",
      userId: "hannah",
    });
    expect(await resolve("Hannah's assistant")).toMatchObject({
      kind: "assistant",
      id: "juno",
    });
    expect(await resolve("Juno")).toMatchObject({ kind: "assistant" });
    expect(await resolve("#Launch team")).toMatchObject({
      kind: "room",
      roomId: "launch",
    });
  });

  it("names who there is when nobody matches, and never a Coworker who cannot chat", async () => {
    await expect(
      resolveRecipient(runtime as never, authorized(), "Rex"),
    ).rejects.toThrow(/Nobody here is called "Rex".*Mira \(Coworker\)/);
  });
});

describe("sendMessage", () => {
  const send = (input: Record<string, unknown> = {}, who = authorized()) =>
    sendMessage(runtime as never, who, {
      to: "Mira",
      message: "What does Langdock cost per seat?",
      toolCallId: "call-1",
      waitSeconds: 0,
      ...input,
    });

  it("asks a Coworker in her question room, delivers at once and hands back her whole answer", async () => {
    watches.chatReplyOutcome.mockResolvedValueOnce("- Mira: €25 per seat.");
    const result = await send({ waitSeconds: 30 });
    expect(runtime.askCoworker).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        coworkerIds: ["mira"],
        capability: "send_message",
      }),
    );
    expect(deliver.deliverSokoBotEffect).toHaveBeenCalledWith("effect-1");
    // Kept on the receipt: its links are sources, and later turns can read it.
    expect(db.sokoBotToolCall.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          result: expect.objectContaining({ reply: "- Mira: €25 per seat." }),
        },
      }),
    );
    expect(result).toMatchObject({
      reply: "- Mira: €25 per seat.",
      messagesToThem: 1,
    });
  });

  it("puts a question to another assistant in a room they share with a person, mentioning them", async () => {
    db.chatRoom.findFirst.mockResolvedValue({
      id: "launch",
      name: "Launch team",
    });
    await send({ to: "Juno" });
    expect(runtime.postChat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        roomId: "launch",
        content: "@Juno What does Langdock cost per seat?",
      }),
      expect.anything(),
    );
  });

  it("waits in the background with `then` when the answer is not there yet", async () => {
    const result = await send({ then: "Tell Robin the price." });
    expect(watches.registerWatch).toHaveBeenCalledWith(expect.anything(), {
      kind: "chat_reply",
      id: "ask-mira",
      then: "Tell Robin the price.",
    });
    expect(result).toMatchObject({ waiting: true });
  });

  it("stops a conversation at four messages to one recipient", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue(
      Array.from({ length: 4 }, () => ({ input: { to: "mira" } })),
    );
    await expect(send()).rejects.toThrow(/Mira \(Coworker\) 4 messages/);
    expect(runtime.askCoworker).not.toHaveBeenCalled();
  });

  it("is for the owner's own requests, and never for an assistant answering another", async () => {
    await expect(send({}, authorized({ chainDepth: 1 }))).rejects.toThrow(
      /just answer/,
    );
    await expect(
      send({}, authorized({}, { askedByKind: "TEAMMATE" })),
    ).rejects.toThrow(/person you work for/);
  });

  it("writes to no person or room after the turn read the web", async () => {
    taint.isTaintBlocked.mockResolvedValue(true);
    await expect(send({ to: "Hannah" })).rejects.toThrow(/read the web/);
    expect(runtime.openDirectChat).not.toHaveBeenCalled();
    await send();
    expect(runtime.askCoworker).toHaveBeenCalled();
  });
});
