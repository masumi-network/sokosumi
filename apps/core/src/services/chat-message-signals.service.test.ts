import { describe, expect, it, vi } from "vitest";

import { expectCoreLog } from "@/test/core-log";

const { updateManyMock } = vi.hoisted(() => ({ updateManyMock: vi.fn() }));

vi.mock("@/lib/ai-gateway-purpose", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-gateway-purpose")>()),
  aiGatewayApiKey: () => "test-only-key",
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { chatMessageSignal: { updateMany: updateManyMock } },
}));
vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

import {
  chatSignalSkipReason,
  readableChatSignalText,
  requeueEditedChatMessageSignal,
} from "./chat-message-signals.service";

const base = {
  senderUserId: "alice",
  deleted: false,
  content: "Can you send the pricing sheet before the call?",
  roomKind: "channel",
  humans: [{ tagDirectMessages: false }, { tagDirectMessages: false }],
};

describe("chatSignalSkipReason", () => {
  it("reads a person's channel message by default", () => {
    expect(chatSignalSkipReason(base)).toBeNull();
  });

  it("never reads coworkers, Soko Bots, deleted or very short messages", () => {
    expect(chatSignalSkipReason({ ...base, senderUserId: null })).toBe(
      "not_human",
    );
    expect(chatSignalSkipReason({ ...base, deleted: true })).toBe("deleted");
    expect(chatSignalSkipReason({ ...base, content: "ok 👍" })).toBe(
      "too_short",
    );
  });

  it("reads a Direct only when every human in it opted in", () => {
    const direct = { ...base, roomKind: "direct" };
    expect(chatSignalSkipReason(direct)).toBe("direct_not_opted_in");
    expect(
      chatSignalSkipReason({
        ...direct,
        humans: [{ tagDirectMessages: true }, { tagDirectMessages: false }],
      }),
    ).toBe("direct_not_opted_in");
    expect(
      chatSignalSkipReason({
        ...direct,
        humans: [{ tagDirectMessages: true }, { tagDirectMessages: true }],
      }),
    ).toBeNull();
  });

  it("never reads a Direct with one human, opted in or not", () => {
    expect(
      chatSignalSkipReason({
        ...base,
        roomKind: "direct",
        humans: [{ tagDirectMessages: true }],
      }),
    ).toBe("solo_direct");
  });
});

describe("readableChatSignalText", () => {
  it("turns mention tokens into names", () => {
    const id = "0190a0a0-0000-7000-8000-000000000001";
    const other = "0190a0a0-0000-7000-8000-000000000002";
    expect(
      readableChatSignalText(
        `@${id} can you check? cc @${other}:dan-smith and @all:all`,
        new Map([[id, "Alice"]]),
      ),
    ).toBe("@Alice can you check? cc @dan-smith and @everyone");
  });
});

describe("requeueEditedChatMessageSignal", () => {
  it("logs one error event, with the message id, when the requeue fails", async () => {
    const errors = expectCoreLog(
      "error",
      "Could not queue an edited chat message for signal tagging",
    );
    updateManyMock.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      requeueEditedChatMessageSignal("message-1"),
    ).resolves.toBeUndefined();

    expect(errors[0]).toMatchObject({ why: "The chat signals step threw" });
    expect(JSON.stringify(errors[0]?.event)).not.toContain("connection reset");
    expect(errors[0]?.event).toMatchObject({
      operation: "chat_message_signals",
      chatMessage: { id: "message-1" },
      failure: { name: "Error" },
    });
  });
});
