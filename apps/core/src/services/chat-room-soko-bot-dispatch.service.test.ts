import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findMember,
  findTurn,
  claim,
  fail,
  placeholder,
  startTurn,
  reconcileTurn,
  TurnInProgress,
} = vi.hoisted(() => ({
  findMember: vi.fn(),
  findTurn: vi.fn(),
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
    sokoBotTurn: { findFirst: findTurn },
  },
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
  SokoBotTurnInProgressError: TurnInProgress,
  sokoBotControlPlane: { startTurn, reconcileTurn },
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
  findMember.mockResolvedValue({ id: "member-a" });
  claim.mockResolvedValue(true);
  placeholder.mockResolvedValue("response-a");
  startTurn.mockResolvedValue({ turnId: "turn-a", status: "COMPLETED" });
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
