import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMember, claim, fail, placeholder, startTurn, reconcileTurn } =
  vi.hoisted(() => ({
    findMember: vi.fn(),
    claim: vi.fn(),
    fail: vi.fn(),
    placeholder: vi.fn(),
    startTurn: vi.fn(),
    reconcileTurn: vi.fn(),
  }));
vi.mock("@/lib/db/prisma", () => ({
  default: { chatRoomSokoBotMember: { findUnique: findMember } },
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
  sokoBotControlPlane: { startTurn, reconcileTurn },
}));

import { runSokoBotMentionDispatch } from "./chat-room-soko-bot-dispatch.service";

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
      sokoBot: { id: "bot-a", userId: "user-a", archivedAt: null },
      sokoBotId: "bot-a",
    },
    userId: "user-a",
    workspaceId: "workspace-a",
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
