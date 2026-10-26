import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import {
  chatSignalPushRecipients,
  type TaggedChatMessage,
} from "./chat-signal-effects.service";

const now = new Date("2026-10-24T12:00:00.000Z");

function message(overrides: Partial<TaggedChatMessage>): TaggedChatMessage {
  return {
    messageId: "m1",
    authorUserId: "bob",
    probabilities: { question: 0.9 },
    addressedUserIds: ["alice"],
    mentionedUserIds: [],
    sentAt: new Date(now.getTime() - 60_000),
    ...overrides,
  };
}

describe("chatSignalPushRecipients", () => {
  it("pushes a sure question or decision to whoever it asks", () => {
    expect(chatSignalPushRecipients(message({}), now)).toEqual(["alice"]);
    expect(
      chatSignalPushRecipients(
        message({ probabilities: { needsDecision: 0.8 } }),
        now,
      ),
    ).toEqual(["alice"]);
  });

  it("pushes urgent and escalation only to the people addressed", () => {
    expect(
      chatSignalPushRecipients(
        message({ probabilities: { urgent: 0.9 } }),
        now,
      ),
    ).toEqual(["alice"]);
    expect(
      chatSignalPushRecipients(
        message({ probabilities: { escalation: 0.9 }, addressedUserIds: [] }),
        now,
      ),
    ).toEqual([]);
  });

  it("stays quiet for chatter, unsure tags, stale reads, the author and anyone already @mentioned", () => {
    for (const quiet of [
      message({ probabilities: { fyi: 0.99, chitChat: 0.9 } }),
      message({ probabilities: { question: 0.7 } }),
      message({ sentAt: new Date(now.getTime() - 31 * 60_000) }),
      message({ addressedUserIds: ["bob"] }),
      message({ mentionedUserIds: ["alice"] }),
    ])
      expect(chatSignalPushRecipients(quiet, now)).toEqual([]);
  });
});
