import { describe, expect, it } from "vitest";
import {
  chatSignalSkipReason,
  readableChatSignalText,
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
