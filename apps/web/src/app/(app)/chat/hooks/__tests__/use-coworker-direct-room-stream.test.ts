import { describe, expect, it } from "vitest";

import { mergeMessagesWithStreamOverlay } from "@/app/chat/utils/merge-room-messages";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import {
  createResumePendingCoworkerShell,
  RESUME_PENDING_STREAM_MESSAGE_ID,
  shouldShowResumePendingCoworkerShell,
} from "../use-coworker-direct-room-stream";

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
  };
}

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
    expect(shell.sender).toEqual({ type: "coworker", coworker });
    expect(shell.metadata).toEqual({ streaming: true });
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
