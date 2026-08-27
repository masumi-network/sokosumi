import { describe, expect, it } from "vitest";

import { mergeMessagesWithStreamOverlay } from "@/app/chat/utils/merge-room-messages";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import {
  assignStableOverlayCreatedAtMs,
  buildCoworkerStreamSendMessageOptions,
  createResumePendingCoworkerShell,
  RESUME_PENDING_STREAM_MESSAGE_ID,
  readStoredStreamParentMessageId,
  shouldShowResumePendingCoworkerShell,
  writeStoredStreamParentMessageId,
} from "./use-coworker-direct-room-stream";

const coworker = {
  id: "cow-1",
  name: "Jamal",
  slug: "jamal",
  caption: null,
  image: null,
  presence: "online" as const,
};

function persistedUser(content: string): ChatRoomMessage {
  return {
    id: "persisted-user",
    roomId: "room-1",
    parentMessageId: null,
    content,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    editedAt: null,
    sender: {
      type: "user",
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    unfurls: null,
    deletedAt: null,
  };
}

describe("assignStableOverlayCreatedAtMs", () => {
  it("reuses the first-seen timestamp for the same message id", () => {
    const map = new Map<string, number>();
    const first = assignStableOverlayCreatedAtMs(map, "msg-a", 0, 1_000);
    const second = assignStableOverlayCreatedAtMs(map, "msg-a", 0, 5_000);
    expect(first).toBe(1_000);
    expect(second).toBe(1_000);
  });

  it("keeps later message ids strictly after earlier ones when assigned in order", () => {
    const map = new Map<string, number>();
    const user = assignStableOverlayCreatedAtMs(map, "user", 0, 1_000);
    const assistant = assignStableOverlayCreatedAtMs(map, "asst", 1, 1_000);
    expect(assistant).toBeGreaterThan(user);
  });
});

describe("buildCoworkerStreamSendMessageOptions", () => {
  it("returns undefined when neither parent nor quote is set", () => {
    expect(buildCoworkerStreamSendMessageOptions()).toBeUndefined();
    expect(buildCoworkerStreamSendMessageOptions({})).toBeUndefined();
    expect(
      buildCoworkerStreamSendMessageOptions({ parentMessageId: "  " }),
    ).toBeUndefined();
  });

  it("puts parentMessageId on the AI SDK body when set", () => {
    expect(
      buildCoworkerStreamSendMessageOptions({
        parentMessageId: "parent-1",
      }),
    ).toEqual({ body: { parentMessageId: "parent-1" } });
  });

  it("puts quote on the AI SDK body when provided", () => {
    expect(
      buildCoworkerStreamSendMessageOptions({
        quote: { messageId: "quote-1" },
      }),
    ).toEqual({ body: { quote: { messageId: "quote-1" } } });
  });

  it("combines parentMessageId and quote in the same body", () => {
    expect(
      buildCoworkerStreamSendMessageOptions({
        parentMessageId: "parent-1",
        quote: { messageId: "quote-1" },
      }),
    ).toEqual({
      body: {
        parentMessageId: "parent-1",
        quote: { messageId: "quote-1" },
      },
    });
  });

  it("trims ids and omits blank quote messageId", () => {
    expect(
      buildCoworkerStreamSendMessageOptions({
        parentMessageId: "  parent-1  ",
        quote: { messageId: "  " },
      }),
    ).toEqual({ body: { parentMessageId: "parent-1" } });
  });
});

describe("shouldShowResumePendingCoworkerShell", () => {
  it("shows shell only while status is streaming with empty messages", () => {
    expect(
      shouldShowResumePendingCoworkerShell({
        messagesEmpty: true,
        status: "streaming",
        hasCoworker: true,
      }),
    ).toBe(true);
  });

  it("hides shell for submitted-only (idle enter / 204 resume)", () => {
    expect(
      shouldShowResumePendingCoworkerShell({
        messagesEmpty: true,
        status: "submitted",
        hasCoworker: true,
      }),
    ).toBe(false);
  });

  it("hides shell when idle, missing coworker, or messages already present", () => {
    expect(
      shouldShowResumePendingCoworkerShell({
        messagesEmpty: true,
        status: "ready",
        hasCoworker: true,
      }),
    ).toBe(false);
    expect(
      shouldShowResumePendingCoworkerShell({
        messagesEmpty: true,
        status: "streaming",
        hasCoworker: false,
      }),
    ).toBe(false);
    expect(
      shouldShowResumePendingCoworkerShell({
        messagesEmpty: false,
        status: "streaming",
        hasCoworker: true,
      }),
    ).toBe(false);
  });
});

describe("createResumePendingCoworkerShell", () => {
  it("builds empty stream coworker shell for Thinking UI", () => {
    const shell = createResumePendingCoworkerShell({
      roomId: "room-1",
      coworker,
      createdAt: new Date("2026-07-01T12:00:01.000Z"),
    });

    expect(shell.id).toBe(RESUME_PENDING_STREAM_MESSAGE_ID);
    expect(shell.content).toBe("");
    expect(shell.parentMessageId).toBeNull();
    expect(shell.sender).toEqual({ type: "coworker", coworker });
    expect(shell.metadata).toEqual({ streaming: true });
  });

  it("can tag resume shell with thread parent for panel routing", () => {
    const shell = createResumePendingCoworkerShell({
      roomId: "room-1",
      coworker,
      parentMessageId: "parent-1",
    });
    expect(shell.parentMessageId).toBe("parent-1");
  });

  it("survives overlay merge so reopen mid-stream can show Thinking", () => {
    const shell = createResumePendingCoworkerShell({
      roomId: "room-1",
      coworker,
    });
    const merged = mergeMessagesWithStreamOverlay(
      [persistedUser("What is your expertise?")],
      [shell],
    );

    expect(merged.map((row) => row.id)).toEqual([
      "persisted-user",
      RESUME_PENDING_STREAM_MESSAGE_ID,
    ]);
    expect(merged.at(-1)?.content.trim()).toBe("");
  });
});

describe("stream parent sessionStorage helpers", () => {
  it("round-trips parent id and clears on null", () => {
    writeStoredStreamParentMessageId("room-1", "parent-1");
    expect(readStoredStreamParentMessageId("room-1")).toBe("parent-1");
    writeStoredStreamParentMessageId("room-1", null);
    expect(readStoredStreamParentMessageId("room-1")).toBeNull();
  });

  it("ignores blank stored values", () => {
    sessionStorage.setItem("sokosumi:room-stream-parent:room-2", "   ");
    expect(readStoredStreamParentMessageId("room-2")).toBeNull();
  });
});

describe("thread vs top-level overlay split", () => {
  it("routes overlays by parentMessageId for panel vs main", () => {
    const topLevel = createResumePendingCoworkerShell({
      roomId: "room-1",
      coworker,
      parentMessageId: null,
    });
    const thread = createResumePendingCoworkerShell({
      roomId: "room-1",
      coworker,
      parentMessageId: "parent-1",
    });
    const overlays = [topLevel, thread];
    expect(
      overlays.filter((message) => message.parentMessageId == null),
    ).toEqual([topLevel]);
    expect(
      overlays.filter((message) => message.parentMessageId === "parent-1"),
    ).toEqual([thread]);
  });
});
