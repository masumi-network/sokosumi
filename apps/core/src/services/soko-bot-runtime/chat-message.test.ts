import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, watches, taint, deliver } = vi.hoisted(() => ({
  db: {
    workspace: { findUnique: vi.fn() },
    sokoBot: { findMany: vi.fn() },
    chatRoom: { findMany: vi.fn(), findFirst: vi.fn() },
    sokoBotTurn: { findMany: vi.fn(), findUnique: vi.fn() },
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
vi.mock("./chat-message-handoff", () => ({
  composeHandoff: async (
    _authorized: unknown,
    input: { message: string; request?: unknown },
  ) => ({ message: input.message, handoff: Boolean(input.request) }),
  guardPrivateData: async () => undefined,
  describeReply: async () => ({ replyStatus: "done", links: [] }),
}));
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

import {
  resolveRecipient,
  sendMessage,
  unknownPersonRefusal,
} from "./chat-message";

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
      requestedByUserId: "robin",
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

describe("unknownPersonRefusal", () => {
  const withTools = (capabilities: string[]) =>
    authorized({}, { grant: { capabilities } });

  it("gives a next step the version has: v33 has ask_coworker, not send_message", async () => {
    const {
      applyVersionCapabilities,
      getSokoBotVersion,
      SOKO_BOT_CAPABILITIES,
    } = await import("@sokosumi/soko-bot");
    const capabilities = applyVersionCapabilities(
      getSokoBotVersion("v33"),
      SOKO_BOT_CAPABILITIES,
    );
    expect(capabilities).not.toContain("send_message");
    const refusal = await unknownPersonRefusal(
      runtime as never,
      withTools([...capabilities]),
      "Mira",
    );
    expect(refusal).not.toContain("send_message");
    expect(refusal).toContain("Ask it with ask_coworker instead.");
  });

  it("points a room to post_chat, and to the owner when no tool reaches it", async () => {
    expect(
      await unknownPersonRefusal(
        runtime as never,
        withTools(["open_direct_chat", "post_chat"]),
        "#Launch team",
      ),
    ).toMatch(/#Launch team \(room\).*Post there with post_chat instead\./);
    expect(
      await unknownPersonRefusal(
        runtime as never,
        withTools(["open_direct_chat"]),
        "Juno",
      ),
    ).toMatch(/Tell the owner you would reach it there\.$/);
  });

  it("names a room only to someone in it (Neon/Codex: requester visibility)", async () => {
    // The bot is in #Launch team; the person asking is not.
    db.chatRoom.findMany
      .mockResolvedValueOnce([
        { id: "launch", name: "Launch team", groupName: null },
      ])
      .mockResolvedValueOnce([]);
    const refusal = await unknownPersonRefusal(
      runtime as never,
      authorized(
        { askedByUserId: "hannah" },
        { grant: { capabilities: ["open_direct_chat", "post_chat"] } },
      ),
      "#Launch team",
    );
    expect(refusal).not.toContain("Launch team (room)");
    expect(refusal).toMatch(/^No member of this organization matches/);
    expect(db.chatRoom.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["launch"] },
        userMembers: { some: { userId: "hannah" } },
      },
      select: { id: true },
    });
  });

  it("suggests no tool a teammate's request may not use on a personal bot", async () => {
    const refusal = await unknownPersonRefusal(
      runtime as never,
      authorized(
        { askedByUserId: "hannah" },
        {
          askedByKind: "TEAMMATE",
          grant: {
            capabilities: ["open_direct_chat", "send_message", "ask_coworker"],
          },
        },
      ),
      "Mira",
    );
    expect(refusal).toBe(
      '"Mira" is Mira (Coworker), not a member of this organization. Tell the person who asked that you would reach it there.',
    );
  });

  it("asks which recipient was meant when a Coworker and an assistant share a name", async () => {
    db.sokoBot.findMany.mockResolvedValueOnce([
      {
        id: "bot-two",
        name: "Mira",
        userId: "hannah",
        user: { name: "Hannah Weber" },
      },
    ]);
    const refusal = await unknownPersonRefusal(
      runtime as never,
      withTools(["open_direct_chat", "ask_coworker", "post_chat"]),
      "Mira",
    );
    expect(refusal).toBe(
      '"Mira" is not a member of this organization; it could be Mira (Coworker), or Mira (Hannah Weber\'s assistant). Ask the owner which one they mean.',
    );
  });

  it("sends a Coworker, an assistant or a room to send_message", async () => {
    const refuse = (person: string) =>
      unknownPersonRefusal(
        runtime as never,
        withTools(["open_direct_chat", "send_message"]),
        person,
      );
    expect(await refuse("Mira")).toBe(
      '"Mira" is Mira (Coworker), not a member of this organization. Write to it with send_message instead.',
    );
    expect(await refuse("Juno")).toMatch(
      /"Juno" is Juno \(Hannah Weber's assistant\).*send_message/,
    );
    expect(await refuse("#Launch team")).toMatch(/#Launch team \(room\)/);
  });

  it("lists the members when nobody by that name is here", async () => {
    expect(
      await unknownPersonRefusal(runtime as never, withTools([]), "Nina"),
    ).toBe(
      'No member of this organization matches "Nina". Members: Hannah Weber. If it is none of them, ask the owner who they mean.',
    );
  });
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

  it("gives a hand-off's reply its status", async () => {
    watches.chatReplyOutcome.mockResolvedValueOnce(
      "- Mira: Done, table attached.",
    );
    expect(
      await send({ waitSeconds: 30, request: { goal: "A plan comparison" } }),
    ).toMatchObject({
      reply: "- Mira: Done, table attached.",
      replyStatus: "done",
    });
    watches.chatReplyOutcome.mockResolvedValueOnce("- Mira: €25.");
    expect(await send({ waitSeconds: 30 })).not.toHaveProperty("replyStatus");
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
    expect(result).toMatchObject({
      waiting: true,
      note: expect.stringMatching(
        /Finish any independent steps.*end your turn/,
      ),
    });
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
