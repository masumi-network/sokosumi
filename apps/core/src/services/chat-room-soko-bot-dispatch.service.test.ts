import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findMember,
  findTurn,
  findMentionTurn,
  releaseMention,
  findOpenDelivery,
  deliverOutbox,
  persistChatTurn,
  publishById,
  transaction,
  claim,
  fail,
  placeholder,
  startTurn,
  reconcileTurn,
  TurnInProgress,
} = vi.hoisted(() => ({
  findMember: vi.fn(),
  findTurn: vi.fn(),
  findMentionTurn: vi.fn(),
  releaseMention: vi.fn(),
  findOpenDelivery: vi.fn(),
  deliverOutbox: vi.fn(),
  persistChatTurn: vi.fn(),
  publishById: vi.fn(),
  transaction: vi.fn(),
  claim: vi.fn(),
  fail: vi.fn(),
  placeholder: vi.fn(),
  startTurn: vi.fn(),
  reconcileTurn: vi.fn(),
  TurnInProgress: class extends Error {},
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomSokoBotMember: { findUnique: findMember },
    sokoBotTurn: {
      findFirst: findTurn,
      findMany: findMentionTurn,
      updateMany: releaseMention,
      findUnique: vi.fn(),
    },
    sokoBotDelivery: { findFirst: findOpenDelivery },
    $transaction: transaction,
  },
}));
vi.mock("@/services/soko-bot-delivery.service", () => ({
  deliverSokoBotTurnOutbox: deliverOutbox,
}));
vi.mock("@/services/soko-bot-chat.service", () => ({
  persistSokoBotChatTurn: persistChatTurn,
}));
vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: publishById,
}));
vi.mock("./chat-room-mention-state", () => ({
  claimMentionForDispatch: claim,
  markMentionFailed: fail,
}));
vi.mock("./chat-room-mention-stream", () => ({
  failMentionWithCoworkerShell: fail,
  publishMentionThoughtPlaceholder: placeholder,
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  ACTIVE_TURN_STATUSES: ["QUEUED", "STARTING", "RUNNING", "CANCEL_REQUESTED"],
  FOREGROUND_TURN: { parentTurnId: null },
  SokoBotTurnInProgressError: TurnInProgress,
  sokoBotControlPlane: { startTurn, reconcileTurn },
}));

const { loadRoomContextMessages } = vi.hoisted(() => ({
  loadRoomContextMessages: vi.fn(),
}));
vi.mock("./chat-room-mention-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./chat-room-mention-context")>()),
  loadRoomContextMessages,
}));

import {
  acceptOnceIdle,
  runSokoBotMentionDispatch,
} from "./chat-room-soko-bot-dispatch.service";

function input(
  message: { content: string; metadata: unknown } = {
    content: "Please answer",
    metadata: null,
  },
) {
  return {
    mentionId: "mention-a",
    mention: {
      message: {
        id: "source-a",
        roomId: "room-a",
        parentMessageId: null,
        ...message,
        senderUser: { id: "user-a", name: "Ada" },
        createdAt: new Date(),
        room: {
          id: "room-a",
          kind: "direct",
          name: "Assistant",
          organizationId: null,
        },
      },
      responseMessageId: null,
      sokoBot: {
        id: "bot-a",
        userId: "user-a",
        workspaceId: "workspace-a",
        archivedAt: null,
      },
      sokoBotId: "bot-a",
    },
    userId: "user-a",
    failWithShell: fail,
    askedByBot: false,
    chainDepth: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadRoomContextMessages.mockResolvedValue([]);
  findMember.mockResolvedValue({ id: "member-a" });
  claim.mockResolvedValue(true);
  placeholder.mockResolvedValue("response-a");
  startTurn.mockResolvedValue({ turnId: "turn-a", status: "COMPLETED" });
  findMentionTurn.mockResolvedValue([]);
  findOpenDelivery.mockResolvedValue(null);
  deliverOutbox.mockResolvedValue(undefined);
  transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        sokoBotTurn: {
          findUnique: async () => ({
            chatResponseMessageId: "response-a",
            chatMention: { messageId: "source-a" },
          }),
        },
      }),
  );
});

describe("Soko Bot mention dispatch", () => {
  it("binds the accepted turn to the existing chat placeholder", async () => {
    await runSokoBotMentionDispatch(input());
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        // The mentioned bot itself: in a DM with Joseph it is Joseph, even
        // when the owner's Cuso lives in the same workspace.
        sokoBotId: "bot-a",
        userId: "user-a",
        workspaceId: "workspace-a",
        message: "Please answer",
        source: "CHAT",
        chat: expect.objectContaining({
          mentionId: "mention-a",
          responseMessageId: "response-a",
        }),
      }),
    );
  });
  it("shows the bot what was said in a direct chat before the new message", async () => {
    loadRoomContextMessages.mockResolvedValue([
      {
        senderName: "Joseph",
        isCoworker: false,
        isSokoBot: true,
        content: "Make — s_New_Registration: two recent errors.",
      },
    ]);
    await runSokoBotMentionDispatch(
      input({ content: "stop messaging me about these", metadata: null }),
    );
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "CONTEXT (last 1 messages in this chat):\n- Joseph (personal assistant): Make — s_New_Registration: two recent errors.\n\nNew message:\nstop messaging me about these",
      }),
    );
  });
  it("runs the mentioned bot in its own workspace, not the room's", async () => {
    // A personal-scope room (organizationId null) with the owner's org bot:
    // the turn must still run that bot, in its organization workspace.
    const base = input();
    await runSokoBotMentionDispatch({
      ...base,
      mention: {
        ...base.mention,
        sokoBot: { ...base.mention.sokoBot, workspaceId: "org-workspace" },
      },
    });
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "org-workspace" }),
    );
  });
  it("hands the bot the quoted message when the body is empty", async () => {
    await runSokoBotMentionDispatch(
      input({
        content: "",
        metadata: {
          quote: {
            messageId: "quoted-a",
            authorName: "Alice",
            snippet: "Launch risk is the vendor.",
          },
        },
      }),
    );
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "> Alice: Launch risk is the vendor.",
      }),
    );
  });
  it("does not open another turn when the dispatch claim loses", async () => {
    claim.mockResolvedValue(false);
    await runSokoBotMentionDispatch(input());
    expect(placeholder).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });
  it("rejects a bot that is no longer a member before starting work", async () => {
    findMember.mockResolvedValue(null);
    await runSokoBotMentionDispatch(input());
    expect(fail).toHaveBeenCalledWith(
      "Soko Bot is no longer a member of this room",
    );
    expect(claim).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });
});

describe("a shared Soko Bot mention", () => {
  function sharedInput(organizationId: string | null = "org-a") {
    const base = input();
    return {
      ...base,
      mention: {
        ...base.mention,
        message: {
          ...base.mention.message,
          senderUser: { id: "user-b", name: "Ben" },
          room: {
            id: "room-a",
            kind: "channel",
            name: "team",
            organizationId,
          },
        },
        sokoBot: { ...base.mention.sokoBot, id: "bot-s", userId: null },
        sokoBotId: "bot-s",
      },
      userId: "user-b",
    };
  }

  it("runs the turn as the member who asked, by the bot's id", async () => {
    await runSokoBotMentionDispatch(sharedInput());
    const [turn] = startTurn.mock.calls[0];
    expect(turn).toMatchObject({
      userId: "user-b",
      sokoBotId: "bot-s",
      workspaceId: "workspace-a",
      chat: expect.objectContaining({ askedByUserId: "user-b" }),
    });
    expect(turn.message).toMatch(/^Ben \(a member of the team\) asked:/);
    expect(turn.message).not.toContain("your owner");
  });

  it("refuses a room outside any organization", async () => {
    await runSokoBotMentionDispatch(sharedInput(null));
    expect(fail).toHaveBeenCalledWith(
      "Only the owner can message this assistant here",
    );
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("runs a turn another bot asked for as that bot's owner", async () => {
    const base = sharedInput();
    await runSokoBotMentionDispatch({
      ...base,
      mention: {
        ...base.mention,
        message: { ...base.mention.message, senderUser: null },
      },
      userId: "user-c",
      askedByBot: true,
      chainDepth: 1,
    });
    const [turn] = startTurn.mock.calls[0];
    expect(turn).toMatchObject({
      userId: "user-c",
      sokoBotId: "bot-s",
      chat: expect.objectContaining({
        askedByUserId: "user-c",
        askedByBot: true,
        chainDepth: 1,
      }),
    });
  });

  it("keeps a personal bot's teammate turn on its owner and that bot", async () => {
    const base = sharedInput();
    await runSokoBotMentionDispatch({
      ...base,
      mention: {
        ...base.mention,
        sokoBot: { ...base.mention.sokoBot, userId: "user-a" },
      },
    });
    const [turn] = startTurn.mock.calls[0];
    expect(turn.userId).toBe("user-a");
    // The id names the mentioned bot itself, not just its owner.
    expect(turn.sokoBotId).toBe(base.mention.sokoBot.id);
    expect(turn.message).toMatch(/^Ben \(a teammate, not your owner\) asked:/);
  });
});

describe("a message sent while the bot is still answering", () => {
  it("waits for the running turn, then starts its own", async () => {
    const accept = vi
      .fn()
      .mockRejectedValueOnce(new TurnInProgress("Soko Bot is already working"))
      .mockResolvedValue({ turnId: "turn-b" });
    findTurn.mockResolvedValueOnce({ id: "turn-a" }).mockResolvedValue(null);
    await expect(
      acceptOnceIdle(accept, "bot-a", { pollMs: 1, waitMs: 5_000 }),
    ).resolves.toEqual({ turnId: "turn-b" });
    expect(accept).toHaveBeenCalledTimes(2);
    expect(findTurn).toHaveBeenCalledTimes(2);
  });

  it("gives up once the wait runs out", async () => {
    const busy = new TurnInProgress("Soko Bot is already working");
    const accept = vi.fn().mockRejectedValue(busy);
    findTurn.mockResolvedValue({ id: "turn-a" });
    await expect(
      acceptOnceIdle(accept, "bot-a", { pollMs: 1, waitMs: 20 }),
    ).rejects.toBe(busy);
  });

  it("does not wait on any other refusal", async () => {
    const paused = new Error(
      "This Soko Bot's owner has paused unprompted work",
    );
    const accept = vi.fn().mockRejectedValue(paused);
    await expect(acceptOnceIdle(accept, "bot-a")).rejects.toBe(paused);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(findTurn).not.toHaveBeenCalled();
  });
});

describe("Retry on a failed Soko Bot reply", () => {
  it("starts a new turn after the one Retry let go of", async () => {
    // Retry released the failed turn from the mention; it still holds the
    // key `chat:<mention>`, which handed it back and left "Thinking…" running.
    findMentionTurn.mockResolvedValue([
      {
        id: "turn-failed",
        clientTurnId: "chat:mention-a",
        chatMentionId: null,
      },
    ]);
    await runSokoBotMentionDispatch(input());
    expect(findMentionTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sokoBotId: "bot-a",
          clientTurnId: { startsWith: "chat:mention-a" },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        clientTurnId: "chat:mention-a:retry:turn-failed",
        chat: expect.objectContaining({ mentionId: "mention-a" }),
      }),
    );
  });
  it("never lets go of the turn holding the mention itself", async () => {
    findMentionTurn.mockResolvedValue([
      {
        id: "turn-done",
        clientTurnId: "chat:mention-a",
        chatMentionId: "mention-a",
      },
    ]);
    await runSokoBotMentionDispatch(input());
    expect(releaseMention).not.toHaveBeenCalled();
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ clientTurnId: "chat:mention-a" }),
    );
  });
});

describe("a reclaimed mention whose turn already ended", () => {
  it("delivers a completed turn's pending answer instead of running it again", async () => {
    // Completed, delivery queued but not landed, mention still `sent`; stale
    // reclaim runs the dispatch again.
    findMentionTurn.mockResolvedValue([
      {
        id: "turn-done",
        clientTurnId: "chat:mention-a",
        chatMentionId: "mention-a",
      },
    ]);
    startTurn.mockResolvedValue({
      turnId: "turn-done",
      status: "COMPLETED",
      duplicate: true,
    });
    findOpenDelivery.mockResolvedValue({ id: "delivery-a" });
    await runSokoBotMentionDispatch(input());
    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ clientTurnId: "chat:mention-a" }),
    );
    expect(deliverOutbox).toHaveBeenCalledWith("turn-done");
    // Then the answer is written if the delivery could not (backoff, lease).
    expect(persistChatTurn).toHaveBeenCalledWith(
      "turn-done",
      expect.anything(),
    );
    expect(releaseMention).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
    expect(reconcileTurn).not.toHaveBeenCalled();
  });
  it("keeps the answer of a turn that completed while the start looked", async () => {
    // Lookup saw it running; it completed before the start checked the key.
    findMentionTurn.mockResolvedValue([
      {
        id: "turn-live",
        clientTurnId: "chat:mention-a",
        chatMentionId: "mention-a",
      },
    ]);
    startTurn.mockResolvedValue({
      turnId: "turn-live",
      status: "COMPLETED",
      duplicate: true,
    });
    await runSokoBotMentionDispatch(input());
    expect(persistChatTurn).toHaveBeenCalledWith(
      "turn-live",
      expect.anything(),
    );
    expect(publishById).toHaveBeenCalledWith("response-a", "update");
    expect(publishById).toHaveBeenCalledWith("source-a", "mention_status");
    expect(fail).not.toHaveBeenCalled();
  });
  it("fails the reply when the ended turn failed and nothing is left to deliver", async () => {
    startTurn.mockResolvedValue({
      turnId: "turn-failed",
      status: "FAILED",
      duplicate: true,
    });
    await runSokoBotMentionDispatch(input());
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionId: "mention-a",
        existingPlaceholderId: "response-a",
      }),
    );
    expect(persistChatTurn).not.toHaveBeenCalled();
    expect(reconcileTurn).not.toHaveBeenCalled();
  });
  it("closes the reply as failed even while the failed turn's delivery is still open", async () => {
    // A PERSISTED delivery only republishes the message as it is now: the
    // reopened "Thinking…". The failed card must come back regardless.
    startTurn.mockResolvedValue({
      turnId: "turn-failed",
      status: "FAILED",
      duplicate: true,
    });
    findOpenDelivery.mockResolvedValue({ id: "delivery-a" });
    deliverOutbox.mockRejectedValueOnce(new Error("Ably down"));
    await runSokoBotMentionDispatch(input());
    expect(deliverOutbox).toHaveBeenCalledWith("turn-failed");
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ existingPlaceholderId: "response-a" }),
    );
  });
});
